// What the page remembers, in this browser only: the posts (IndexedDB), the
// ticks and moves you made, and a few preferences. Nothing here is sent anywhere.

const DB_NAME = "classping-web";
const STORE = "kv";

function open() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) return reject(new Error("no IndexedDB"));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function get(key, fallback = null) {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => resolve(request.result === undefined ? fallback : request.result);
      request.onerror = () => resolve(fallback);
    });
  } catch (e) { return fallback; }
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

export async function wipe() {
  try {
    const db = await open();
    await new Promise((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = resolve;
      tx.onerror = resolve;
    });
  } catch (e) { /* nothing stored */ }
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
