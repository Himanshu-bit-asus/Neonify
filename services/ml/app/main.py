import asyncio
import logging
import os
import pickle
import time
from pathlib import Path
from typing import Any

import implicit
import numpy as np
import pandas as pd
import psycopg
from fastapi import BackgroundTasks, FastAPI, HTTPException, Header
from redis import Redis
from scipy.sparse import csr_matrix
from sklearn.cluster import KMeans

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

MODEL_DIR = Path(os.getenv("MODEL_DIR", "/app/model"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)

DATABASE_URL = os.getenv("DATABASE_URL", "")
# Read-only DB role for training queries (falls back to main URL if not set)
READ_ONLY_DATABASE_URL = os.getenv("READ_ONLY_DATABASE_URL", "") or DATABASE_URL
CACHE_TTL = int(os.getenv("RECOMMENDATION_CACHE_TTL", "86400"))
INTERNAL_TOKEN = os.getenv("INTERNAL_TOKEN", "")

redis = Redis.from_url(os.getenv("REDIS_URL", "redis://redis:6379"), decode_responses=True)
app = FastAPI(title="Streamify Recommendations", version="2.0.0")

# ─── In-memory artifact cache ────────────────────────────────────────────────

_artifact: dict[str, Any] | None = None
_artifact_mtime: float = 0.0
_training_lock = asyncio.Lock()


def _pkl_path() -> Path:
    return MODEL_DIR / "als_latest.pkl"


def _npz_path() -> Path:
    return MODEL_DIR / "recommendations.npz"


def _load_artifact() -> dict[str, Any] | None:
    """Load from pkl (preferred) or fall back to legacy npz."""
    global _artifact, _artifact_mtime

    pkl = _pkl_path()
    npz = _npz_path()

    source = pkl if pkl.exists() else (npz if npz.exists() else None)
    if source is None:
        return None

    mtime = source.stat().st_mtime
    if _artifact is not None and mtime == _artifact_mtime:
        return _artifact  # already up-to-date

    try:
        if source.suffix == ".pkl":
            with open(source, "rb") as f:
                data = pickle.load(f)
        else:
            raw = np.load(source, allow_pickle=True)
            data = {
                "users": raw["users"].tolist(),
                "songs": raw["songs"].tolist(),
                "recommendations": raw["recommendations"].tolist(),
                "item_factors": np.asarray(raw["item_factors"], dtype=float),
            }
        _artifact = data
        _artifact_mtime = mtime
        logger.info("Loaded model artifact from %s", source)
    except Exception as exc:
        logger.warning("Failed to load artifact: %s", exc)
        return _artifact  # return stale if available

    return _artifact


# ─── Helpers ─────────────────────────────────────────────────────────────────


def popular_song_ids(limit: int) -> list[str]:
    if not DATABASE_URL:
        return []
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                "SELECT id FROM songs WHERE is_published = true AND status = 'READY' "
                "ORDER BY play_count DESC LIMIT %s",
                (limit,),
            )
            return [row[0] for row in cursor.fetchall()]


def _weighted_popular(limit: int) -> list[str]:
    """Trending score = play_count + 3× plays in the last 7 days."""
    if not DATABASE_URL:
        return []
    with psycopg.connect(DATABASE_URL) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT s.id,
                       s.play_count + COALESCE(3 * r.recent_plays, 0) AS score
                FROM   songs s
                LEFT JOIN (
                    SELECT song_id, COUNT(*) AS recent_plays
                    FROM   listening_events
                    WHERE  created_at >= NOW() - INTERVAL '7 days'
                    GROUP  BY song_id
                ) r ON r.song_id = s.id
                WHERE  s.is_published = true AND s.status = 'READY'
                ORDER  BY score DESC
                LIMIT  %s
                """,
                (limit,),
            )
            return [row[0] for row in cursor.fetchall()]


def artifact_recommendations(user_id: str, limit: int) -> list[str]:
    data = _load_artifact()
    if data is None:
        return []
    users: list[str] = data["users"]
    if user_id not in users:
        return []
    rows: list[list[str]] = data["recommendations"]
    return rows[users.index(user_id)][:limit]


def artifact_similar_song_ids(song_id: str, limit: int) -> list[str]:
    data = _load_artifact()
    if data is None:
        return []
    songs: list[str] = data["songs"]
    if song_id not in songs:
        return []
    factors = np.asarray(data["item_factors"], dtype=float)
    seed_index = songs.index(song_id)
    seed = factors[seed_index]
    norms = np.linalg.norm(factors, axis=1) * np.linalg.norm(seed)
    scores = np.divide(
        factors @ seed,
        norms,
        out=np.full(len(songs), -np.inf),
        where=norms > 0,
    )
    scores[seed_index] = -np.inf
    positions = np.argsort(scores)[::-1]
    return [songs[p] for p in positions[:limit] if np.isfinite(scores[p])]


# ─── Training pipeline ───────────────────────────────────────────────────────


def _run_training() -> dict[str, Any]:
    """Full ALS training pipeline. Runs synchronously inside a thread."""
    logger.info("[train] starting export from PostgreSQL")
    query = """
      SELECT user_id, song_id,
             SUM(play_duration_seconds + CASE WHEN completed THEN 60 ELSE 0 END)::float AS strength
      FROM   listening_events
      WHERE  created_at >= NOW() - INTERVAL '180 days'
      GROUP  BY user_id, song_id
      HAVING SUM(play_duration_seconds) >= 15
    """
    with psycopg.connect(READ_ONLY_DATABASE_URL) as conn:
        events = pd.read_sql(query, conn)

    if events.empty:
        logger.warning("[train] no eligible events — keeping current model")
        return {"trained": False, "reason": "no_events"}

    users = events.user_id.astype(str).unique()
    songs = events.song_id.astype(str).unique()
    user_index = {v: i for i, v in enumerate(users)}
    song_index = {v: i for i, v in enumerate(songs)}

    matrix = csr_matrix(
        (
            events.strength.clip(upper=3600),
            (
                [user_index[v] for v in events.user_id.astype(str)],
                [song_index[v] for v in events.song_id.astype(str)],
            ),
        ),
        shape=(len(users), len(songs)),
    )

    logger.info("[train] fitting ALS (%d users × %d songs)", len(users), len(songs))
    model = implicit.als.AlternatingLeastSquares(
        factors=64, regularization=0.05, iterations=25, random_state=42
    )
    model.fit(matrix, show_progress=False)

    # Generate per-user top-60 recommendations
    recommendations: list[list[str]] = []
    for u in range(len(users)):
        positions, _ = model.recommend(u, matrix[u], N=60, filter_already_liked_items=True)
        recommendations.append([songs[p] for p in positions])

    # Versioned artifact: timestamp in filename
    version = int(time.time())
    payload = {
        "version": version,
        "users": users.tolist(),
        "songs": songs.tolist(),
        "recommendations": recommendations,
        "item_factors": model.item_factors,
    }

    tmp = MODEL_DIR / "als_latest.next.pkl"
    target = _pkl_path()
    with open(tmp, "wb") as f:
        pickle.dump(payload, f, protocol=pickle.HIGHEST_PROTOCOL)
    tmp.replace(target)  # atomic swap

    # Reload in-memory cache
    _load_artifact()

    # Invalidate all recommendation Redis keys
    for key in redis.scan_iter("reco:*"):
        redis.delete(key)
    redis.delete("popular:v1")

    # Warm Redis cache for top 1000 active users
    warm_count = min(1000, len(users))
    for u in range(warm_count):
        user_id = users[u]
        rec_ids = recommendations[u][:24]
        if rec_ids:
            rkey = f"reco:{user_id}"
            redis.rpush(rkey, *rec_ids)
            redis.expire(rkey, CACHE_TTL)

    redis.publish("training:complete", str(version))

    logger.info("[train] done — version=%d users=%d songs=%d warmed=%d", version, len(users), len(songs), warm_count)
    return {"trained": True, "version": version, "users": len(users), "songs": len(songs), "warmed": warm_count}


# ─── HTTP endpoints ───────────────────────────────────────────────────────────


@app.get("/healthz")
def health() -> dict[str, str]:
    pkl_ok = _pkl_path().exists()
    npz_ok = _npz_path().exists()
    return {
        "status": "ok",
        "model": "ready" if (pkl_ok or npz_ok) else "cold-start",
        "format": "pkl" if pkl_ok else ("npz-legacy" if npz_ok else "none"),
    }


@app.post("/train")
async def trigger_training(background_tasks: BackgroundTasks) -> dict[str, Any]:
    """Trigger nightly ALS training. Returns immediately; training runs in background."""
    if _training_lock.locked():
        return {"started": False, "reason": "already_running"}
    background_tasks.add_task(_training_task)
    return {"started": True}


async def _training_task() -> None:
    async with _training_lock:
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, _run_training)


@app.get("/popular")
def popular(limit: int = 30) -> dict[str, Any]:
    """Weighted trending songs (play_count + 3× recent plays)."""
    if limit < 1 or limit > 100:
        raise HTTPException(400, "limit must be between 1 and 100")
    cache_key = "popular:v1"
    cached = redis.lrange(cache_key, 0, limit - 1)
    if cached:
        return {"songIds": cached, "strategy": "cached-weighted-popular"}
    song_ids = _weighted_popular(100)  # fetch more, cache all, serve slice
    strategy = "weighted-popular" if song_ids else "fallback-popular"
    if not song_ids:
        song_ids = popular_song_ids(100)
    if song_ids:
        redis.delete(cache_key)
        redis.rpush(cache_key, *song_ids)
        redis.expire(cache_key, 3600)  # 1h TTL
    return {"songIds": song_ids[:limit], "strategy": strategy}


@app.get("/recommendations/{user_id}")
def recommendations(user_id: str, limit: int = 24) -> dict[str, Any]:
    if limit < 1 or limit > 100:
        raise HTTPException(400, "limit must be between 1 and 100")
    key = f"reco:{user_id}"
    cached = redis.lrange(key, 0, limit - 1)
    if cached:
        return {"songIds": cached, "strategy": "cached-als"}
    song_ids = artifact_recommendations(user_id, limit)
    strategy = "als" if song_ids else "cold-start-popular"
    if not song_ids:
        song_ids = popular_song_ids(limit)
    if song_ids:
        redis.delete(key)
        redis.rpush(key, *song_ids)
        redis.expire(key, CACHE_TTL)
    return {"songIds": song_ids, "strategy": strategy}


@app.get("/recommend/similar/{song_id}")
def similar_songs(song_id: str, top: int = 20) -> dict[str, Any]:
    if top < 1 or top > 50:
        raise HTTPException(400, "top must be between 1 and 50")
    song_ids = artifact_similar_song_ids(song_id, top)
    strategy = "als-item-similarity" if song_ids else "cold-start-popular"
    if not song_ids:
        song_ids = [c for c in popular_song_ids(top + 1) if c != song_id][:top]
    return {"songIds": song_ids, "strategy": strategy}


@app.post("/internal/cache/{user_id}")
def invalidate_cache(
    user_id: str, x_internal_token: str | None = Header(default=None)
) -> dict[str, bool]:
    if INTERNAL_TOKEN and x_internal_token != INTERNAL_TOKEN:
        raise HTTPException(401, "invalid internal token")
    redis.delete(f"reco:{user_id}")
    return {"invalidated": True}


@app.get("/recommend/daily-mixes/{user_id}")
def daily_mixes(user_id: str, count: int = 4, tracks_per_mix: int = 25) -> dict[str, Any]:
    """K-Means clustering on ALS item factors to generate personalized Daily Mixes."""
    all_songs = popular_song_ids(100)
    mix_themes = [
        {"title": "Daily Mix 1", "subtitle": "Electronic & Pulse", "art": "midnight"},
        {"title": "Chill Mix", "subtitle": "Indie Pop & Warmth", "art": "focus"},
        {"title": "Energy Mix", "subtitle": "Late-Night Beats", "art": "discovery"},
        {"title": "Focus Flow", "subtitle": "Ambient & Instrumental", "art": "sunset"},
    ]
    generated_mixes: list[dict[str, Any]] = []
    data = _load_artifact()

    if data is not None:
        try:
            model_songs: list[str] = data["songs"]
            factors = np.asarray(data["item_factors"], dtype=float)
            n_clusters = min(count, len(factors))
            kmeans = KMeans(n_clusters=n_clusters, random_state=42, n_init="auto").fit(factors)
            for cluster_idx in range(n_clusters):
                centroid = kmeans.cluster_centers_[cluster_idx]
                scores = factors @ centroid
                ranked = np.argsort(-scores)
                theme = mix_themes[cluster_idx % len(mix_themes)]
                picked = [model_songs[i] for i in ranked if i < len(model_songs)][:tracks_per_mix]
                if not picked:
                    picked = all_songs[:tracks_per_mix]
                generated_mixes.append(
                    {
                        "id": f"mix-{cluster_idx + 1}",
                        "title": theme["title"],
                        "subtitle": theme["subtitle"],
                        "art": theme["art"],
                        "songIds": picked,
                        "cluster": cluster_idx,
                    }
                )
        except Exception as exc:
            logger.warning("[daily-mixes] clustering failed: %s", exc)

    if not generated_mixes:
        for idx in range(min(count, len(mix_themes))):
            theme = mix_themes[idx]
            offset = idx * 10
            sliced = all_songs[offset : offset + tracks_per_mix] or all_songs[:tracks_per_mix]
            generated_mixes.append(
                {
                    "id": f"mix-{idx + 1}",
                    "title": theme["title"],
                    "subtitle": theme["subtitle"],
                    "art": theme["art"],
                    "songIds": sliced,
                    "cluster": idx,
                }
            )

    return {"userId": user_id, "mixes": generated_mixes}
