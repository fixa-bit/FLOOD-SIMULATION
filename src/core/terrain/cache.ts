/**
 * IndexedDB Cache for DEM Elevation and Textures
 * Enables instant reloads for previously selected areas.
 */

const DB_NAME = 'floodsim_cache_db';
const DB_VERSION = 1;
const STORE_DEM = 'dem_tiles';

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }

  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_DEM)) {
          db.createObjectStore(STORE_DEM, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export function generateCacheKey(
  west: number,
  south: number,
  east: number,
  north: number,
  gridSize: number
): string {
  return `${west.toFixed(4)}_${south.toFixed(4)}_${east.toFixed(4)}_${north.toFixed(4)}_${gridSize}`;
}

export async function getCachedDem(key: string): Promise<Float32Array | null> {
  const db = await openDatabase();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_DEM, 'readonly');
      const store = transaction.objectStore(STORE_DEM);
      const request = store.get(key);

      request.onsuccess = () => {
        if (request.result && request.result.elevation) {
          resolve(new Float32Array(request.result.elevation));
        } else {
          resolve(null);
        }
      };
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function setCachedDem(key: string, elevation: Float32Array): Promise<void> {
  const db = await openDatabase();
  if (!db) return;

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_DEM, 'readwrite');
      const store = transaction.objectStore(STORE_DEM);
      // Store as ArrayBuffer for efficient serialization
      store.put({
        key,
        elevation: elevation.buffer,
        timestamp: Date.now(),
      });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}
