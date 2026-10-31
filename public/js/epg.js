// EPG (programme guide): a small request queue, a per-channel cache, and painting
// of "what's on now" into any element marked with data-epg-id.

import { b64decode } from './util.js';
import { apiXtream } from './api.js';
import { whenVisible } from './artwork.js';

const EPG_CONCURRENCY = 3;
let epgCache = {}; // `${kind}:${streamId}` -> { listings, at, promise }
const epgQueue = [];
let epgActive = 0;

export function resetEpg() {
  epgCache = {};
  epgQueue.length = 0;
}

function epgRequest(action, params, urgent) {
  return new Promise((resolve, reject) => {
    const job = { action, params, resolve, reject };
    if (urgent) epgQueue.unshift(job); else epgQueue.push(job);
    pumpEpg();
  });
}

function pumpEpg() {
  while (epgActive < EPG_CONCURRENCY && epgQueue.length) {
    const job = epgQueue.shift();
    epgActive += 1;
    apiXtream(job.action, job.params).then(job.resolve, job.reject).finally(() => {
      epgActive -= 1;
      pumpEpg();
    });
  }
}

// Timestamps are UTC epochs; the "start"/"end" strings are a fallback (treated as UTC).
function parseListing(l) {
  const ts = (n, str) => (Number(n) > 0 ? Number(n) * 1000 : Date.parse(String(str || '').replace(' ', 'T') + 'Z'));
  return {
    start: ts(l.start_timestamp, l.start),
    end: ts(l.stop_timestamp || l.end_timestamp, l.end || l.stop),
    title: b64decode(l.title) || 'Untitled',
    desc: b64decode(l.description),
  };
}

export function epgNeedsFetch(entry) {
  if (!entry) return true;
  if (entry.promise) return false;
  const now = Date.now();
  if (entry.listings.some((l) => l.start <= now && l.end > now)) return false;
  return now - entry.at > (entry.listings.length ? 60e3 : 15 * 60e3);
}

export const epgEntry = (streamId, kind = 'short') => epgCache[`${kind}:${streamId}`];

// kind "short" = now/next (cheap, for cards and lists); "full" = whole schedule.
export function loadEpg(streamId, kind = 'short', urgent = false) {
  const key = `${kind}:${streamId}`;
  const entry = epgCache[key];
  if (!epgNeedsFetch(entry)) return entry.promise || Promise.resolve(entry.listings);
  const action = kind === 'full' ? 'get_simple_data_table' : 'get_short_epg';
  const params = kind === 'full' ? { stream_id: streamId } : { stream_id: streamId, limit: 4 };
  const fresh = { listings: entry ? entry.listings : [], at: Date.now(), promise: null };
  fresh.promise = epgRequest(action, params, urgent)
    .then((data) => {
      const now = Date.now();
      fresh.listings = (data.epg_listings || [])
        .map(parseListing)
        .filter((l) => l.end > now - 6 * 3600e3 && l.start < now + 48 * 3600e3)
        .sort((a, b) => a.start - b.start);
    })
    .catch(() => {})
    .then(() => {
      fresh.at = Date.now();
      fresh.promise = null;
      return fresh.listings;
    });
  epgCache[key] = fresh;
  return fresh.promise;
}

export function epgListings(streamId) {
  const full = epgCache[`full:${streamId}`];
  if (full && full.listings.length) return full.listings;
  const short = epgCache[`short:${streamId}`];
  return short ? short.listings : [];
}

export function nowProgram(streamId) {
  const now = Date.now();
  return epgListings(streamId).find((l) => l.start <= now && l.end > now) || null;
}

export const progressPct = (p) => Math.min(100, Math.max(0, ((Date.now() - p.start) / (p.end - p.start)) * 100));

// Any element with data-epg-id shows that channel's current programme in its
// .epg-title and .epg-bar children.
function paintEpg(node) {
  const p = nowProgram(node.dataset.epgId);
  const title = node.querySelector('.epg-title');
  const bar = node.querySelector('.epg-bar');
  if (title) title.textContent = p ? p.title : '';
  if (bar) {
    bar.hidden = !p;
    if (p) bar.firstElementChild.style.width = `${progressPct(p).toFixed(1)}%`;
  }
}

export function paintEpgFor(streamId) {
  document.querySelectorAll(`[data-epg-id="${CSS.escape(String(streamId))}"]`).forEach(paintEpg);
}

export function watchEpg(node, streamId) {
  node.dataset.epgId = streamId;
  paintEpg(node);
  whenVisible(node, () => loadEpg(streamId).then(() => paintEpgFor(streamId)));
}

// Keeps progress bars moving and rolls over to the next programme when one ends.
export function tickEpg() {
  document.querySelectorAll('[data-epg-id]').forEach((node) => {
    paintEpg(node);
    const id = node.dataset.epgId;
    if (!nowProgram(id) && epgNeedsFetch(epgCache[`short:${id}`])) {
      whenVisible(node, () => loadEpg(id).then(() => paintEpgFor(id)));
    }
  });
}
