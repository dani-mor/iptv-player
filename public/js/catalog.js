// The provider's catalogue: categories and items per tab, cached in memory for the
// session and in IndexedDB across launches (see cachedApi).

import { apiXtream, cachedApi } from './api.js';
import { library } from './library.js';
import { versionKey, qualityRank } from './names.js';

export const ACTIONS = {
  live: { categories: 'get_live_categories', streams: 'get_live_streams' },
  vod: { categories: 'get_vod_categories', streams: 'get_vod_streams' },
  series: { categories: 'get_series_categories', streams: 'get_series' },
};
const CONCURRENCY = 5;

let categories = {}; // type -> [categories]
let streams = {}; // `${type}:${categoryId}` -> [items]
let all = {}; // type -> every item
let allPending = {}; // type -> Promise

export function resetCatalog() {
  categories = {};
  streams = {};
  all = {};
  allPending = {};
}

export async function getCategories(type, onFresh) {
  if (!categories[type]) {
    const list = await cachedApi(ACTIONS[type].categories, {}, (fresh) => {
      categories[type] = fresh;
      if (onFresh) onFresh(fresh);
    });
    categories[type] = Array.isArray(list) ? list : [];
  }
  return categories[type];
}

export async function getStreams(type, categoryId, onFresh) {
  const key = `${type}:${categoryId}`;
  if (!streams[key]) {
    const list = await cachedApi(ACTIONS[type].streams, { category_id: categoryId }, (fresh) => {
      streams[key] = fresh;
      if (onFresh) onFresh(fresh);
    });
    streams[key] = Array.isArray(list) ? list : [];
  }
  return streams[key];
}

export const allLoaded = (type) => !!all[type];

// Every item of a tab. Most panels return everything when no category is given, which is
// one request instead of one per category; otherwise fall back to fetching each category.
export function loadAll(type) {
  if (all[type]) return Promise.resolve(all[type]);
  if (!allPending[type]) {
    allPending[type] = (async () => {
      let list = await cachedApi(ACTIONS[type].streams, {}, (fresh) => {
        if (Array.isArray(fresh) && fresh.length) all[type] = fresh;
      }).catch(() => null);
      if (!Array.isArray(list) || !list.length) {
        const cats = await getCategories(type);
        const perCat = new Array(cats.length);
        let idx = 0;
        const worker = async () => {
          while (idx < cats.length) {
            const i = idx++;
            perCat[i] = await apiXtream(ACTIONS[type].streams, { category_id: cats[i].category_id }).catch(() => []);
          }
        };
        await Promise.all(Array.from({ length: CONCURRENCY }, worker));
        list = perCat.flat(); // category order, whichever finished first
      }
      all[type] = list;
      return list;
    })().finally(() => { delete allPending[type]; });
  }
  return allPending[type];
}

// Every live channel we know about without asking the provider again.
export function livePool() {
  if (all.live) return all.live;
  const seen = new Map();
  const add = (ch) => { if (!seen.has(String(ch.stream_id))) seen.set(String(ch.stream_id), ch); };
  Object.entries(streams).forEach(([key, list]) => { if (key.startsWith('live:')) list.forEach(add); });
  library.favs.forEach(add);
  library.recents.forEach(add);
  return [...seen.values()];
}

// The same channel in other qualities (FHD / HD / SD ...), best first, including `item`.
export function versionsOf(item, pool = livePool()) {
  const key = versionKey(item.name);
  if (!key) return [item];
  const found = new Map([[String(item.stream_id), item]]);
  pool.forEach((ch) => {
    if (!found.has(String(ch.stream_id)) && versionKey(ch.name) === key) found.set(String(ch.stream_id), ch);
  });
  return [...found.values()].sort((a, b) => qualityRank(a.name) - qualityRank(b.name));
}
