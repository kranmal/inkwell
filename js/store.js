// Documents live in IndexedDB so they survive reloads without a server.
const DB = 'inkwell', STORE = 'docs';

function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { res(req && req.result); db.close(); };
    t.onerror = () => { rej(t.error); db.close(); };
  });
}

export const store = {
  put: (doc) => tx('readwrite', (s) => s.put(doc)),
  get: (id) => tx('readonly', (s) => s.get(id)),
  all: () => tx('readonly', (s) => s.getAll()),
  del: (id) => tx('readwrite', (s) => s.delete(id)),
};
