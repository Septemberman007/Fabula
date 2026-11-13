/**
 * Malé úložiště klíč → hodnota nad IndexedDB. Na rozdíl od localStorage nemá limit pár megabajtů,
 * takže se do něj vejde i celovečerní scénář se zálohami, a umí uložit i odkaz na složku na disku.
 */
let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  opening ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('fabula', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      opening = null;
      reject(req.error);
    };
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction('kv', mode);
        const req = op(tx.objectStore('kv'));
        // U zápisu čekáme na dokončení celé transakce, ne jen požadavku: teprve pak jsou data na disku.
        if (mode === 'readonly') req.onsuccess = () => resolve(req.result as T);
        else tx.oncomplete = () => resolve(req.result as T);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const dbGet = <T>(key: string) => run<T | undefined>('readonly', (s) => s.get(key));
export const dbSet = (key: string, value: unknown) => run<void>('readwrite', (s) => s.put(value, key));
export const dbDel = (key: string) => run<void>('readwrite', (s) => s.delete(key));
