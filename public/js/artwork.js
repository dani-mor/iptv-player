// Images: lazy loading, fade-in, dead-host detection, and the server-side TV show
// artwork fallback (TMDB / Wikidata / TVmaze) for providers whose covers are offline.

import { icon, qs, yearOf } from './util.js';

// One shared observer for "do this once the element scrolls near the screen":
// fallback artwork lookups and EPG fetches only happen for what the user can see.
const visibleCallbacks = new WeakMap();
const lazyObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry) => {
    if (!entry.isIntersecting) return;
    const cbs = visibleCallbacks.get(entry.target) || [];
    visibleCallbacks.delete(entry.target);
    lazyObserver.unobserve(entry.target);
    cbs.forEach((cb) => cb());
  });
}, { rootMargin: '300px' });

export function whenVisible(node, cb) {
  const cbs = visibleCallbacks.get(node);
  if (cbs) { cbs.push(cb); return; }
  visibleCallbacks.set(node, [cb]);
  lazyObserver.observe(node);
}

// Tracks image hosts that never deliver, so cards skip straight to the fallback
// instead of each waiting on a dead server.
const hostHealth = {};
const hostOf = (url) => { try { return new URL(url, location.href).host; } catch { return ''; } };
function noteHost(url, ok) {
  const h = hostHealth[hostOf(url)] || (hostHealth[hostOf(url)] = { ok: 0, fail: 0 });
  if (ok) h.ok += 1; else h.fail += 1;
}
export function hostIsDead(url) {
  const h = hostHealth[hostOf(url)];
  return !!h && h.ok === 0 && h.fail >= 3;
}

// Loads an image with a fade-in over a placeholder glyph. If it fails (or its host is
// known dead) and a fallback is given, asks the fallback for another URL once visible.
export function fillThumb(container, url, fallbackIcon, fallback) {
  container.insertAdjacentHTML('afterbegin', `<span class="placeholder">${icon(fallbackIcon)}</span>`);
  const show = (src, onFail) => {
    const img = document.createElement('img');
    img.loading = 'lazy';
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { noteHost(src, true); img.classList.add('loaded'); container.classList.add('has-img'); };
    img.onerror = () => { noteHost(src, false); img.remove(); if (onFail) onFail(); };
    img.src = src;
    container.firstElementChild.after(img);
  };
  const tryFallback = fallback && (() => whenVisible(container, () => {
    fallback().then((alt) => { if (alt) show(alt, null); }).catch(() => {});
  }));
  if (url && !hostIsDead(url)) show(url, tryFallback);
  else if (tryFallback) tryFallback();
}

export function probeImage(url) {
  return new Promise((resolve) => {
    if (!url || hostIsDead(url)) { resolve(false); return; }
    const img = new Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { noteHost(url, true); resolve(true); };
    img.onerror = () => { noteHost(url, false); resolve(false); };
    img.src = url;
  });
}

// First URL from the list that actually loads, or null.
export async function firstLoadable(urls) {
  for (const url of urls) {
    if (url && await probeImage(url)) return url;
  }
  return null;
}

export function setBackground(node, url) {
  if (!url || !node.isConnected) return;
  node.style.backgroundImage = `url("${url.replace(/["\\\n]/g, '')}")`;
  node.classList.add('loaded');
}

// ---------- Show artwork fallback (server matches shows on TMDB / TVmaze) ----------

const artworkMemo = {};
const artworkDetailsMemo = {};
const fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

export function seriesArtwork(series) {
  const id = series.series_id;
  if (!artworkMemo[id]) {
    artworkMemo[id] = fetchJson(`/api/artwork/series?${qs({ name: series.name, year: yearOf(series.releaseDate || series.year), tmdb: series.tmdb_id })}`);
  }
  return artworkMemo[id];
}

export async function seriesArtworkDetails(series) {
  const art = await seriesArtwork(series);
  if (!art || !art.id) return null;
  if (!artworkDetailsMemo[art.id]) artworkDetailsMemo[art.id] = fetchJson(`/api/artwork/show/${encodeURIComponent(art.id)}`);
  return artworkDetailsMemo[art.id];
}

export const posterFallback = (series) => () => seriesArtwork(series).then((a) => a && a.poster);

export const episodeFallback = (series, season, episodeNum) => async () => {
  const [art, details] = await Promise.all([seriesArtwork(series), seriesArtworkDetails(series)]);
  return (details && (details.episodes[`${season}:${episodeNum}`] || details.backdrop)) || (art && art.poster) || null;
};

// Keeps only the fields artwork lookups need, so they survive in saved progress.
export const seriesRef = (s, cover) => ({
  series_id: s.series_id, name: s.name, cover: cover || s.cover, releaseDate: s.releaseDate || s.year, tmdb_id: s.tmdb_id || s.tmdb,
});
