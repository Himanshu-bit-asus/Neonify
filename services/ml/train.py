"""Scheduled ALS training job. Run daily after the event aggregation window closes."""
import os
from pathlib import Path

import implicit
import numpy as np
import pandas as pd
import psycopg
from scipy.sparse import csr_matrix

MODEL_DIR = Path(os.getenv("MODEL_DIR", "/app/model"))
MODEL_DIR.mkdir(parents=True, exist_ok=True)


def main() -> None:
    database_url = os.environ["DATABASE_URL"]
    query = """
      SELECT user_id, song_id,
             SUM(play_duration_seconds + CASE WHEN completed THEN 60 ELSE 0 END)::float AS strength
      FROM listening_events
      WHERE created_at >= NOW() - INTERVAL '180 days'
      GROUP BY user_id, song_id
      HAVING SUM(play_duration_seconds) >= 15
    """
    with psycopg.connect(database_url) as connection:
        events = pd.read_sql(query, connection)
    if events.empty:
        print("No eligible events; keeping current recommendation model")
        return
    users = events.user_id.astype(str).unique()
    songs = events.song_id.astype(str).unique()
    user_index = {value: index for index, value in enumerate(users)}
    song_index = {value: index for index, value in enumerate(songs)}
    matrix = csr_matrix((events.strength.clip(upper=3600), ([user_index[value] for value in events.user_id.astype(str)], [song_index[value] for value in events.song_id.astype(str)])), shape=(len(users), len(songs)))
    model = implicit.als.AlternatingLeastSquares(factors=64, regularization=0.05, iterations=25, random_state=42)
    model.fit(matrix, show_progress=False)
    recommendations: list[list[str]] = []
    for user_position in range(len(users)):
        song_positions, _ = model.recommend(user_position, matrix[user_position], N=60, filter_already_liked_items=True)
        recommendations.append([songs[position] for position in song_positions])
    target = MODEL_DIR / "recommendations.npz"
    temporary = MODEL_DIR / "recommendations.next.npz"
    np.savez_compressed(
        temporary,
        users=np.array(users),
        songs=np.array(songs),
        recommendations=np.array(recommendations, dtype=object),
        item_factors=model.item_factors,
    )
    temporary.replace(target)
    print(f"trained ALS model for {len(users)} users and {len(songs)} songs")


if __name__ == "__main__":
    main()
