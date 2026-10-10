// Keeps scanned pages on the phone's storage (IndexedDB), not in memory
const NAME = "pdfgen-scan";
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(NAME, 1);
      r.onupgradeneeded = () => {
        for (const s of ["files", "meta", "kv"]) {
          if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s);
        }
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => { dbp = null; reject(new Error("Your browser blocked storage. Turn off private mode and try again")); };
    });
  }
  return dbp;
}

async function run(stores, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(stores, mode);
    const req = fn(t);
    t.oncomplete = () => resolve(req && "result" in req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

export const savePage = (id, files, meta) =>
  run(["files", "meta"], "readwrite", (t) => {
    t.objectStore("files").put(files, id);
    t.objectStore("meta").put(meta, id);
  });

export const getFiles = (id) => run(["files"], "readonly", (t) => t.objectStore("files").get(id));
export const getMeta = (id) => run(["meta"], "readonly", (t) => t.objectStore("meta").get(id));

export const removePage = (id) =>
  run(["files", "meta"], "readwrite", (t) => {
    t.objectStore("files").delete(id);
    t.objectStore("meta").delete(id);
  });

export const saveOrder = (ids) => run(["kv"], "readwrite", (t) => t.objectStore("kv").put(ids, "order"));
export const loadOrder = async () => (await run(["kv"], "readonly", (t) => t.objectStore("kv").get("order"))) || [];

// last time the user did anything, used for the auto-destruct timer
export const touch = () => run(["kv"], "readwrite", (t) => t.objectStore("kv").put(Date.now(), "touched"));
export const lastTouched = async () => (await run(["kv"], "readonly", (t) => t.objectStore("kv").get("touched"))) || 0;

export const clearAll = () =>
  run(["files", "meta", "kv"], "readwrite", (t) => {
    t.objectStore("files").clear();
    t.objectStore("meta").clear();
    t.objectStore("kv").clear();
  });