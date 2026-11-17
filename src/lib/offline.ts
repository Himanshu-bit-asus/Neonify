/**
 * Streamify Offline Storage Engine
 * Manages client-side IndexedDB caching of audio blobs (key: song:{id}:{bitrate})
 * Enforces a 100-song cap with least-recently-played (LRU) auto-eviction
 * Supports 7-day license freshness verification.
 */

import type { Song } from "@/lib/catalog";

const DB_NAME = "streamify-offline";
const DB_VERSION = 1;
const STORE_NAME = "songs";
export const MAX_OFFLINE_SONGS = 100;
export const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export interface OfflineSongRecord {
  id: string;
  songId: string;
  bitrate: "160k" | "320k";
  blob: Blob;
  downloadedAt: number;
  lastPlayedAt: number;
  licenseExpiresAt: number;
  metadata: {
    title: string;
    artist: string;
    album: string;
    duration: number;
    genre: string;
    cover: string;
    accent: string;
  };
}

let dbPromise: Promise<IDBDatabase> | null = null;

function getDB(): Promise<IDBDatabase> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB is only available in the browser"));
  }

  if (!dbPromise) {
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("songId", "songId", { unique: false });
          store.createIndex("lastPlayedAt", "lastPlayedAt", { unique: false });
          store.createIndex("downloadedAt", "downloadedAt", { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  return dbPromise;
}

/**
 * Save audio blob and song metadata to IndexedDB
 */
export async function saveSongToOffline(
  song: Song,
  blob: Blob,
  bitrate: "160k" | "320k" = "320k",
  licenseExpiresAt = Date.now() + SEVEN_DAYS_MS
): Promise<void> {
  const db = await getDB();
  const id = `song:${song.id}:${bitrate}`;
  const now = Date.now();

  const record: OfflineSongRecord = {
    id,
    songId: song.id,
    bitrate,
    blob,
    downloadedAt: now,
    lastPlayedAt: now,
    licenseExpiresAt,
    metadata: {
      title: song.title,
      artist: song.artist,
      album: song.album,
      duration: song.duration,
      genre: song.genre,
      cover: song.cover,
      accent: song.accent,
    },
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });

  // Auto-evict least recently played if quota exceeds MAX_OFFLINE_SONGS
  await enforceOfflineStorageLimit();
}

/**
 * Retrieve cached blob for a song ID (checks 320k first, falls back to 160k)
 */
export async function getOfflineSongBlob(songId: string): Promise<{ blob: Blob; bitrate: string } | null> {
  const db = await getDB();

  return new Promise<{ blob: Blob; bitrate: string } | null>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);

    // Try 320k first
    const key320 = `song:${songId}:320k`;
    const req320 = store.get(key320);

    req320.onsuccess = () => {
      const record: OfflineSongRecord | undefined = req320.result;
      if (record) {
        // Check if license is still valid
        if (record.licenseExpiresAt && record.licenseExpiresAt < Date.now()) {
          store.delete(key320);
          resolve(null);
          return;
        }
        // Update lastPlayedAt for LRU
        record.lastPlayedAt = Date.now();
        store.put(record);
        resolve({ blob: record.blob, bitrate: record.bitrate });
        return;
      }

      // Check 160k fallback
      const key160 = `song:${songId}:160k`;
      const req160 = store.get(key160);
      req160.onsuccess = () => {
        const rec160: OfflineSongRecord | undefined = req160.result;
        if (rec160) {
          if (rec160.licenseExpiresAt && rec160.licenseExpiresAt < Date.now()) {
            store.delete(key160);
            resolve(null);
            return;
          }
          rec160.lastPlayedAt = Date.now();
          store.put(rec160);
          resolve({ blob: rec160.blob, bitrate: rec160.bitrate });
        } else {
          resolve(null);
        }
      };
      req160.onerror = () => reject(req160.error);
    };

    req320.onerror = () => reject(req320.error);
  });
}

/**
 * Check if a song is downloaded locally
 */
export async function isSongDownloaded(songId: string): Promise<boolean> {
  const db = await getDB();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(`song:${songId}:320k`);
    req.onsuccess = () => {
      if (req.result) {
        resolve(req.result.licenseExpiresAt > Date.now());
        return;
      }
      const req160 = store.get(`song:${songId}:160k`);
      req160.onsuccess = () => resolve(Boolean(req160.result && req160.result.licenseExpiresAt > Date.now()));
      req160.onerror = () => reject(req160.error);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete a downloaded song from offline storage
 */
export async function deleteOfflineSong(songId: string): Promise<void> {
  const db = await getDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.delete(`song:${songId}:320k`);
    store.delete(`song:${songId}:160k`);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Get all downloaded songs as catalog-ready Song items
 */
export async function getAllOfflineSongs(): Promise<Song[]> {
  const db = await getDB();
  return new Promise<Song[]>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const records = (req.result as OfflineSongRecord[]) || [];
      const now = Date.now();
      const songsMap = new Map<string, Song>();

      for (const rec of records) {
        if (rec.licenseExpiresAt && rec.licenseExpiresAt < now) continue;
        if (!songsMap.has(rec.songId)) {
          songsMap.set(rec.songId, {
            id: rec.songId,
            title: rec.metadata.title,
            artist: rec.metadata.artist,
            album: rec.metadata.album,
            duration: rec.metadata.duration,
            genre: rec.metadata.genre,
            plays: "Offline",
            cover: rec.metadata.cover,
            accent: rec.metadata.accent,
          });
        }
      }
      resolve(Array.from(songsMap.values()));
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Get all downloaded song IDs
 */
export async function getDownloadedSongIds(): Promise<Set<string>> {
  const songs = await getAllOfflineSongs();
  return new Set(songs.map((s) => s.id));
}

/**
 * Evict least recently played items if count > MAX_OFFLINE_SONGS
 */
export async function enforceOfflineStorageLimit(max = MAX_OFFLINE_SONGS): Promise<number> {
  const db = await getDB();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const records = (req.result as OfflineSongRecord[]) || [];
      if (records.length <= max) {
        resolve(0);
        return;
      }

      records.sort((a, b) => a.lastPlayedAt - b.lastPlayedAt);
      const toDelete = records.slice(0, records.length - max);
      for (const item of toDelete) {
        store.delete(item.id);
      }
      resolve(toDelete.length);
    };

    req.onerror = () => reject(req.error);
  });
}

/**
 * Purge stale/expired licenses or refresh when app reconnects
 */
export async function purgeStaleLicenses(validSongIds?: Set<string>): Promise<number> {
  const db = await getDB();
  const now = Date.now();
  return new Promise<number>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();

    req.onsuccess = () => {
      const records = (req.result as OfflineSongRecord[]) || [];
      let purged = 0;
      for (const rec of records) {
        const isExpired = rec.licenseExpiresAt < now;
        const isRevoked = validSongIds && !validSongIds.has(rec.songId);
        if (isExpired || isRevoked) {
          store.delete(rec.id);
          purged++;
        }
      }
      resolve(purged);
    };

    req.onerror = () => reject(req.error);
  });
}
