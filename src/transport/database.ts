/** IndexedDB promises settle only after the containing transaction commits. */
import { db, setDb } from './song';

type StoreName = 'songs' | 'meta';
export function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('sequencer-db', 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('songs'))
        database.createObjectStore('songs', { keyPath: 'id' });
      if (!database.objectStoreNames.contains('meta')) database.createObjectStore('meta');
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        setDb(null);
      };
      setDb(database);
      resolve(database);
    };
    request.onerror = () => reject(request.error ?? new Error('Song storage could not be opened.'));
    request.onblocked = () =>
      reject(new Error('Song storage is blocked by another tab. Close it and retry.'));
  });
}
export function transactionResult<T>(tx: IDBTransaction, result: () => T): Promise<T> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(result());
    tx.onabort = tx.onerror = () =>
      reject(tx.error ?? new Error('Song storage transaction was aborted.'));
  });
}
function request<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  if (!db) return Promise.reject(new Error('Song storage is not open.'));
  try {
    const tx = db.transaction(store, mode);
    const pending = run(tx.objectStore(store));
    return transactionResult(tx, () => pending.result);
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}
export function dbPut(store: StoreName, value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
  return request(store, 'readwrite', (s) => (key === undefined ? s.put(value) : s.put(value, key)));
}
export function dbGet<T = unknown>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return request(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}
export function dbGetAll<T = unknown>(store: StoreName): Promise<T[]> {
  return request(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}
export async function dbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  await request(store, 'readwrite', (s) => s.delete(key));
}
