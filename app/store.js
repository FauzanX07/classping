// What the page remembers, in this browser only: the posts (IndexedDB), the
// ticks and moves you made, and a few preferences. Nothing here is sent anywhere.

const DB_NAME = "classping-web";
const STORE = "kv";

let dbPromise = null;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("no IndexedDB"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); dbPromise = null; };   // never hold up another tab or an upgrade
      db.onclose = () => { dbPromise = null; };
      resolve(db);
    };
    request.onerror = () => reject(request.error);
  });
  dbPromise.catch(() => { dbPromise = null; });
  return dbPromise;
}

// -- other tabs of this page ---------------------------------------------------------------
// Tabs share one IndexedDB. A tab says when it saved or erased something, and the others
// read it again, so a tick made in one tab is never undone by another tab's older copy.
let channel = null;
try { if ("BroadcastChannel" in window) channel = new BroadcastChannel("classping-web"); } catch (e) { channel = null; }
const PING = "classping-web-ping";

export function announce(kind) {
  try {
    if (channel) channel.postMessage({ kind });
    else localStorage.setItem(PING, kind + ":" + Date.now() + ":" + Math.random());
  } catch (e) { /* the other tabs catch up the next time they look */ }
}

export function listen(handler) {
  if (channel) channel.onmessage = (event) => handler(event.data && event.data.kind);
  else window.addEventListener("storage", (event) => { if (event.key === PING && event.newValue) handler(event.newValue.split(":")[0]); });
}

export async function get(key, fallback = null) {
  const all = await readAll([key]);
  return all[key] === undefined ? fallback : all[key];
}

// Several keys read in one transaction, so they belong together.
export async function readAll(keys) {
  const out = {};
  try {
    const db = await open();
    await new Promise((resolve) => {
      const os = db.transaction(STORE).objectStore(STORE);
      for (const key of keys) {
        const request = os.get(key);
        request.onsuccess = () => { out[key] = request.result; };
      }
      const tx = os.transaction;
      tx.oncomplete = resolve; tx.onerror = resolve; tx.onabort = resolve;
    });
  } catch (e) { /* nothing stored */ }
  return out;
}

export async function set(key, value) {
  try {
    const db = await open();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch (e) { return false; }
}

// Saves what this tab holds in ONE transaction. The ticks and moves are not simply replaced:
// `mergeMarks` gets what is stored right now (another tab may have changed it) and returns what
// to keep. The posts are kept only if they are not older than what another tab already saved.
// `allow()` is asked inside the transaction: false (erased or switched meanwhile) writes nothing.
// Returns {marks, postsKept} or {skipped: true}, or null if the browser would not save.
export async function save(plain, mergeMarks, allow) {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const os = tx.objectStore(STORE);
      let result = null;
      os.get("marks").onsuccess = (a) => {
        os.get("lastSync").onsuccess = (b) => {
          if (allow && !allow()) { result = { skipped: true }; return; }
          const theirs = Date.parse(b.target.result || "") || 0;
          const ours = Date.parse(plain.lastSync || "") || 0;
          const keep = ours >= theirs;
          if (keep) for (const [key, value] of Object.entries(plain)) os.put(value, key);
          const marks = mergeMarks(a.target.result || {});
          os.put(marks, "marks");
          result = { marks, postsKept: keep };
        };
      };
      tx.oncomplete = () => resolve(result);
      tx.onerror = tx.onabort = () => resolve(null);
    });
  } catch (e) { return null; }
}

export async function wipe() {
  try {
    const db = await open();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
      tx.onabort = resolve;
    });
  } catch (e) { /* nothing stored */ }
  announce("erased");
}

// Small preferences live in localStorage; every access is guarded because it
// can be blocked (private windows, strict settings).
const PREFS = "classping-web-prefs";
const DEFAULT_PREFS = { notify: false, range: "any", showDone: false, email: "" };

export function prefs() {
  try { return { ...DEFAULT_PREFS, ...(JSON.parse(localStorage.getItem(PREFS) || "{}") || {}) }; }
  catch (e) { return { ...DEFAULT_PREFS }; }
}

export function savePrefs(patch) {
  const next = { ...prefs(), ...patch };
  try { localStorage.setItem(PREFS, JSON.stringify(next)); } catch (e) { /* blocked */ }
  return next;
}

export function forgetPrefs() {
  try { localStorage.removeItem(PREFS); } catch (e) { /* blocked */ }
}
