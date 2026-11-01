// The provider's programme guide for the sports channels, indexed per account so the
// match finder and the Sport Center can search it. Built from xmltv.php (one download)
// or, when the provider doesn't serve that, from get_simple_data_table per channel.
// Kept in memory and in .guide-cache/<sha256(server|username)>.json; never the password.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { normTitle } = require('./titles');
const { createXmltvParser } = require('./xmltv');
const { qualityRank } = require('../public/js/names.js');

// Category names that hold sports channels. Kept loose: the index only covers these
// (plus favourites), so a miss here means a channel can't be found by the finder.
const SPORTS_CATEGORY = /deport|sport|f[uú]tbol|futbol|laliga|liga|premier|serie a|bundesliga|ligue|dazn|champions|europa|copa|\bf1\b|formula|motor|moto ?gp|tenis|tennis|nfl|nba|eurosport|m\+/i;

const MAX_AGE_MS = 3 * 3600e3;
const KEEP_PAST_MS = 6 * 3600e3;
const KEEP_AHEAD_MS = 8 * 24 * 3600e3;
const DESC_MAX = 400;
const PER_CHANNEL_CONCURRENCY = 3;
const FORMAT_VERSION = 1;

const indexKey = (server, username) => crypto.createHash('sha256').update(`${server}|${username}`).digest('hex').slice(0, 32);

const streamRef = (s) => ({ stream_id: s.stream_id, name: s.name, stream_icon: s.stream_icon || '', category_id: s.category_id });
const bestFirst = (streams) => streams.slice().sort((a, b) => qualityRank(a.name) - qualityRank(b.name));

// The sports subset of the live list: streams in sports categories plus the extra ids.
function sportsStreams(categories, streams, extraIds = []) {
  const sportsCats = new Set((categories || []).filter((c) => SPORTS_CATEGORY.test(c.category_name || '')).map((c) => String(c.category_id)));
  const extra = new Set(extraIds.map(String));
  return {
    categories: sportsCats.size,
    streams: (streams || []).filter((s) => sportsCats.has(String(s.category_id)) || extra.has(String(s.stream_id))),
  };
}

// epg_channel_id (lower-cased) -> every stream that carries it (FHD / HD / SD copies).
function channelMap(streams) {
  const map = {};
  streams.forEach((s) => {
    const id = String(s.epg_channel_id || '').trim().toLowerCase();
    if (!id) return;
    (map[id] || (map[id] = { streams: [] })).streams.push(streamRef(s));
  });
  Object.values(map).forEach((c) => { c.streams = bestFirst(c.streams); });
  return map;
}

const trimDesc = (d) => (d && d.length > DESC_MAX ? `${d.slice(0, DESC_MAX - 1)}…` : d || '');

// ---------- Search ----------

// Folded " title " / " desc " strings, computed once per index and never saved.
function folded(index) {
  if (!index._folded) {
    Object.defineProperty(index, '_folded', {
      enumerable: false,
      value: index.programmes.map((p) => [` ${normTitle(p.title)} `, ` ${normTitle(p.desc)} `]),
    });
  }
  return index._folded;
}

// Every query word must start a word of the title (3 points) or description (1 point).
// Order: on now (best match first), then upcoming by start time, then the recent past.
function searchGuide(index, query, now = Date.now(), limit = 50) {
  const words = normTitle(query).split(' ').filter(Boolean);
  if (!index || !words.length) return [];
  const texts = folded(index);
  const hits = [];
  index.programmes.forEach((p, i) => {
    if (p.end <= now - KEEP_PAST_MS) return;
    const [t, d] = texts[i];
    let score = 0;
    for (const w of words) {
      const inTitle = t.includes(` ${w}`);
      if (!inTitle && !d.includes(` ${w}`)) return;
      score += inTitle ? 3 : 1;
    }
    const bucket = p.start <= now && p.end > now ? 0 : p.start > now ? 1 : 2;
    hits.push({ p, score, bucket });
  });
  hits.sort((a, b) => a.bucket - b.bucket
    || (a.bucket === 0 ? b.score - a.score || a.p.start - b.p.start
      : a.bucket === 1 ? a.p.start - b.p.start || b.score - a.score
        : b.p.end - a.p.end));
  return hits.slice(0, limit).map(({ p }) => {
    const streams = (index.channels[p.channel] || { streams: [] }).streams;
    return { streams, channel: streams[0] ? streams[0].name : p.channel, start: p.start, end: p.end, title: p.title, desc: p.desc };
  });
}

// Programmes on any channel overlapping [from, to), with the channel's streams.
function programmesBetween(index, from, to) {
  if (!index) return [];
  return index.programmes
    .filter((p) => p.start < to && p.end > from)
    .map((p) => ({ ...p, streams: (index.channels[p.channel] || { streams: [] }).streams }));
}

// ---------- Building ----------

async function fromXmltv(response, channels, now) {
  const stats = { status: response.status, bytes: 0 };
  if (!response.ok || !response.body) {
    response.body?.cancel().catch(() => {});
    return { programmes: null, stats };
  }
  const parser = createXmltvParser({ keep: (id) => !!channels[id.toLowerCase()], from: now - KEEP_PAST_MS, to: now + KEEP_AHEAD_MS });
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let first = true;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    stats.bytes += value.length;
    const text = decoder.decode(value, { stream: true });
    // Some panels answer with an HTML or JSON error page instead of the guide.
    if (first && !/<\?xml|<tv[\s>]|<!DOCTYPE tv/i.test(text.slice(0, 4096))) {
      reader.cancel().catch(() => {});
      stats.notXml = text.slice(0, 120);
      return { programmes: null, stats };
    }
    first = false;
    parser.push(text);
  }
  const out = parser.end();
  stats.channels = out.totalChannels;
  stats.programmes = out.totalProgrammes;
  const programmes = out.programmes.map((p) => ({ channel: p.channel.toLowerCase(), start: p.start, end: p.end, title: p.title, desc: trimDesc(p.desc) }));
  return { programmes, stats };
}

const b64 = (s) => {
  if (!s) return '';
  try { return Buffer.from(String(s), 'base64').toString('utf8'); } catch { return String(s); }
};

async function fromPerChannel(playerApi, channels, now) {
  const ids = Object.keys(channels);
  const programmes = [];
  let failed = 0;
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      try {
        const data = await playerApi({ action: 'get_simple_data_table', stream_id: channels[id].streams[0].stream_id });
        (data.epg_listings || []).forEach((l) => {
          const start = Number(l.start_timestamp) * 1000;
          const end = Number(l.stop_timestamp || l.end_timestamp) * 1000;
          if (!(end > now - KEEP_PAST_MS) || !(start < now + KEEP_AHEAD_MS)) return;
          programmes.push({ channel: id, start, end, title: b64(l.title) || 'Untitled', desc: trimDesc(b64(l.description)) });
        });
      } catch {
        failed += 1;
      }
    }
  };
  await Promise.all(Array.from({ length: PER_CHANNEL_CONCURRENCY }, worker));
  return { programmes, stats: { requests: ids.length, failed } };
}

// Programmes repeated by overlapping sources (same channel, start and title) once.
function dedupe(programmes) {
  const seen = new Set();
  return programmes.filter((p) => {
    const k = `${p.channel}|${p.start}|${p.title}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).sort((a, b) => a.start - b.start);
}

async function buildIndex({ playerApi, xmltv, extraIds = [], now = Date.now() }) {
  const started = Date.now();
  const [categories, allStreams] = await Promise.all([
    playerApi({ action: 'get_live_categories' }),
    playerApi({ action: 'get_live_streams' }),
  ]);
  if (!Array.isArray(allStreams)) throw new Error('The provider returned no channel list');
  const subset = sportsStreams(categories, allStreams, extraIds);
  const channels = channelMap(subset.streams);

  let source = 'xmltv';
  let result = { programmes: null, stats: {} };
  const t0 = Date.now();
  try {
    result = await fromXmltv(await xmltv(), channels, now);
  } catch (e) {
    result.stats = { error: e.name === 'AbortError' ? 'timed out' : e.message };
  }
  const xmltvStats = { ...result.stats, ms: Date.now() - t0 };
  if (!result.programmes || !result.programmes.length) {
    source = 'per-channel';
    result = await fromPerChannel(playerApi, channels, now);
  }
  const programmes = dedupe(result.programmes);
  const covered = new Set(programmes.filter((p) => p.end > now && p.start < now + 7 * 24 * 3600e3).map((p) => p.channel));
  return {
    version: FORMAT_VERSION,
    builtAt: Date.now(),
    source,
    channels,
    programmes,
    // Everything in the sports categories, for "best guess" lookups by channel name.
    streams: subset.streams.map(streamRef),
    stats: {
      buildMs: Date.now() - started,
      liveStreams: allStreams.length,
      sportsCategories: subset.categories,
      sportsStreams: subset.streams.length,
      withEpgId: subset.streams.filter((s) => String(s.epg_channel_id || '').trim()).length,
      epgChannels: Object.keys(channels).length,
      epgChannelsWithProgrammes7d: covered.size,
      programmes: programmes.length,
      xmltv: xmltvStats,
      perChannel: source === 'per-channel' ? result.stats : undefined,
    },
  };
}

// ---------- Store: memory + disk, one build at a time per account ----------

function createGuideStore({ dir }) {
  const memory = new Map(); // key -> index
  const building = new Map(); // key -> Promise<index>
  const errors = new Map(); // key -> last build error message
  const file = (key) => path.join(dir, `${key}.json`);

  function load(key) {
    if (memory.has(key)) return memory.get(key);
    try {
      const index = JSON.parse(fs.readFileSync(file(key), 'utf8'));
      if (index.version === FORMAT_VERSION) {
        memory.set(key, index);
        return index;
      }
    } catch {
      // not built yet
    }
    return null;
  }

  function save(key, index) {
    fs.mkdir(dir, { recursive: true }, () => {
      const tmp = `${file(key)}.tmp`;
      fs.writeFile(tmp, JSON.stringify(index), (err) => { if (!err) fs.rename(tmp, file(key), () => {}); });
    });
  }

  // source: { key, playerApi, xmltv, extraIds }
  function rebuild(source) {
    const { key } = source;
    if (!building.has(key)) {
      const p = buildIndex(source)
        .then((index) => {
          memory.set(key, index);
          errors.delete(key);
          save(key, index);
          const s = index.stats;
          console.log(`[guide] built from ${index.source} in ${s.buildMs} ms: ${s.epgChannelsWithProgrammes7d}/${s.epgChannels} channels with programmes, ${s.programmes} programmes`);
          return index;
        })
        .catch((e) => {
          errors.set(key, e.message);
          console.log(`[guide] build failed: ${e.message}`);
          return load(key);
        })
        .finally(() => building.delete(key));
      building.set(key, p);
    }
    return building.get(key);
  }

  // The current index (possibly stale, possibly null), starting a rebuild when needed.
  // With wait, a missing index is built before returning.
  async function get(source, { wait = false } = {}) {
    const index = load(source.key);
    const stale = !index || Date.now() - index.builtAt > MAX_AGE_MS;
    if (stale) {
      const p = rebuild(source);
      if (!index && wait) return p;
    }
    return index;
  }

  const isBuilding = (key) => building.has(key);
  const lastError = (key) => errors.get(key) || null;

  return { get, isBuilding, lastError };
}

module.exports = {
  SPORTS_CATEGORY, indexKey, sportsStreams, channelMap, searchGuide, programmesBetween, buildIndex, createGuideStore,
};
