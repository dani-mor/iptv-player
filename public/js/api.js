// Talking to our server (which talks to the provider), plus an IndexedDB cache of
// the big lists so the app can draw its first screen before the network answers.

import { qs } from './util.js';

export const session = { creds: null, userInfo: null };

export const accountKey = () => `${session.creds.username}@${session.creds.server}`;

async function readJson(r) {
  try {
    return await r.json();
  } catch {
    return {};
  }
}

// One of our server's endpoints, with this account's credentials.
export async function apiServer(path, extra = {}) {
  const r = await fetch(`${path}?${qs({ ...session.creds, ...extra })}`);
  const data = await readJson(r);
  if (!r.ok || data.error) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
}

export const apiXtream = (action, extra = {}) => apiServer('/api/xtream', { action, ...extra });

export async function doLogin(c) {
  let r;
  try {
    r = await fetch(`/api/login?${qs(c)}`);
  } catch {
    throw Object.assign(new Error('The IPTV player server is not running'), { status: 0 });
  }
  const data = await readJson(r);
  if (!r.ok || data.error) throw Object.assign(new Error(data.error || `Login failed (${r.status})`), { status: r.status });
  return data;
}

export const streamUrl = (type, id, ext) => `/stream?${qs({ ...session.creds, type, id, ext })}`;

// ---------- List cache (stale-while-revalidate) ----------

const DB_NAME = 'iptv-cache';
const STORE = 'lists';
let dbPromise = null;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

async function idb(mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const idbGet = (key) => idb('readonly', (s) => s.get(key)).catch(() => null);
const idbSet = (key, value) => idb('readwrite', (s) => s.put(value, key)).catch(() => {});

export const clearListCache = () => idb('readwrite', (s) => s.clear()).catch(() => {});

// Same items in the same order (by id)? Used to skip pointless re-renders.
const itemId = (x) => x.stream_id ?? x.series_id ?? x.category_id;
export function sameList(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (itemId(a[i]) !== itemId(b[i]) || a[i].name !== b[i].name || a[i].category_name !== b[i].category_name) return false;
  }
  return true;
}

// Returns the cached copy right away when there is one and refreshes it in the
// background; onFresh(fresh) runs only if the provider's answer differs.
export async function cachedApi(action, params = {}, onFresh) {
  const key = `${accountKey()}|${action}|${qs(params)}`;
  const cached = await idbGet(key);
  const fresh = apiXtream(action, params).then((data) => {
    idbSet(key, { data, at: Date.now() });
    return data;
  });
  if (cached && cached.data) {
    fresh.then((data) => { if (onFresh && !sameList(data, cached.data)) onFresh(data); }).catch(() => {});
    return cached.data;
  }
  return fresh;
}
