const express = require('express');
const fs = require('fs');
const path = require('path');
const { Readable, pipeline } = require('stream');
const { proxiedMediaUrl, isPlaylistUrl, rewritePlaylist } = require('./lib/playlist');
const { movieTailRange, sendTailInParallel } = require('./lib/tail');
const { normTitle, cleanShowName, pickShow } = require('./lib/titles');
const { indexKey, searchGuide, programmesBetween, createGuideStore } = require('./lib/guide-index');
const sports = require('./lib/sports');
const { fetchMotoGpEvents } = require('./lib/motogp');
const { matchEvents, guessChannels, isHomeChannel, countryOf } = require('./lib/fixture-match');
const { rankEvents } = require('./lib/rank');

// Optional settings (e.g. TMDB_API_KEY) can live in a .env file next to this one.
try {
  process.loadEnvFile(path.join(__dirname, '.env'));
} catch {
  // no .env, or Node < 20.12
}

const app = express();
const PORT = process.env.PORT || 4040;
// Loopback only by default: /proxy/media fetches any URL it is given, so anyone who can
// reach this server could use it as an open proxy. Set HOST=0.0.0.0 to watch from
// other devices on a network you trust.
const HOST = process.env.HOST || '';
const DEFAULT_UA = 'IPTVSmartersPlayer';
const REQUEST_TIMEOUT_MS = 20000;

app.use(express.static(path.join(__dirname, 'public')));
// hls.js is served from the pinned npm copy, so playback doesn't depend on a CDN.
app.use('/vendor', express.static(path.dirname(require.resolve('hls.js/dist/hls.min.js')), { maxAge: '7d' }));

function normalizeServer(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error('Server address is required');
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  const u = new URL(s);
  return `${u.protocol}//${u.host}`;
}

function withTimeout(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

// Generic Xtream Codes player_api.php call (categories, streams, series info, vod info, login, ...)
app.get('/api/xtream', async (req, res) => {
  const { server, username, password, ua, action, ...rest } = req.query;
  if (!server || !username || !password) {
    return res.status(400).json({ error: 'server, username and password are required' });
  }
  const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const base = normalizeServer(server);
    const params = new URLSearchParams({ username, password });
    if (action) params.set('action', action);
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined && v !== '') params.set(k, v);
    }
    const apiUrl = `${base}/player_api.php?${params.toString()}`;
    const r = await fetch(apiUrl, { headers: { 'User-Agent': ua || DEFAULT_UA }, signal });
    if (!r.ok) {
      r.body?.cancel().catch(() => {});
      return res.status(502).json({ error: `Provider responded with HTTP ${r.status}` });
    }
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return res.status(502).json({ error: 'Provider returned a non-JSON response', raw: text.slice(0, 300) });
    }
    res.status(200).json(data);
  } catch (e) {
    const timedOut = e.name === 'AbortError';
    res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'Provider request timed out' : 'Could not reach provider', detail: e.message });
  } finally {
    cancel();
  }
});

app.get('/api/login', async (req, res) => {
  const { server, username, password, ua } = req.query;
  if (!server || !username || !password) {
    return res.status(400).json({ error: 'server, username and password are required' });
  }
  const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const base = normalizeServer(server);
    const apiUrl = `${base}/player_api.php?username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
    const r = await fetch(apiUrl, { headers: { 'User-Agent': ua || DEFAULT_UA }, signal });
    if (!r.ok) {
      return res.status(502).json({ error: `Provider responded with HTTP ${r.status}` });
    }
    let data;
    try {
      data = JSON.parse(await r.text());
    } catch {
      return res.status(502).json({ error: 'Provider returned an unexpected (non-JSON) response. Check the server address.' });
    }
    if (!data || !data.user_info) {
      return res.status(502).json({ error: 'Unexpected response shape from provider' });
    }
    if (String(data.user_info.auth) !== '1') {
      return res.status(401).json({ error: data.user_info.message || 'Authentication failed. Check your username and password.' });
    }
    res.json({ user_info: data.user_info, server_info: data.server_info });
  } catch (e) {
    const timedOut = e.name === 'AbortError';
    res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'Connection to provider timed out' : (e.message || 'Could not reach provider') });
  } finally {
    cancel();
  }
});

async function fetchUpstream(url, options) {
  try {
    return await fetch(url, options);
  } catch (e) {
    if (options.signal.aborted) throw e;
    return fetch(url, options);
  }
}

async function handleMediaProxy(req, res, targetUrl, ua) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  // Release the provider connection as soon as the player stops listening
  // (channel switch, hls.js cancelling a load) instead of leaking it.
  res.on('close', () => controller.abort());

  try {
    const headers = { 'User-Agent': ua };
    if (req.headers.range) headers['Range'] = req.headers.range;

    // Xtream live playlists 302 to a load-balanced edge, and each edge numbers segments
    // differently. Playlist redirects go to the browser so hls.js keeps reloading the edge
    // it started on; following them here would land each reload on a random edge and
    // break the live timeline.
    const upstream = await fetchUpstream(targetUrl, {
      headers,
      redirect: isPlaylistUrl(targetUrl) ? 'manual' : 'follow',
      signal: controller.signal,
    });
    clearTimeout(timer);

    const location = upstream.headers.get('location');
    if (upstream.status >= 300 && upstream.status < 400 && location) {
      upstream.body?.cancel().catch(() => {});
      res.set('Cache-Control', 'no-store');
      res.redirect(302, proxiedMediaUrl(new URL(location, targetUrl).toString(), ua));
      return;
    }

    const contentType = upstream.headers.get('content-type') || '';
    if (upstream.ok && (contentType.includes('mpegurl') || isPlaylistUrl(targetUrl))) {
      const text = await upstream.text();
      res.status(upstream.status);
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-store');
      res.send(rewritePlaylist(text, targetUrl, ua));
      return;
    }

    const tail = movieTailRange(req.headers.range, upstream);
    if (tail) {
      upstream.body?.cancel().catch(() => {});
      await sendTailInParallel(res, upstream.url || targetUrl, targetUrl, ua, tail, contentType, controller.signal);
      return;
    }

    res.status(upstream.status);
    for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'cache-control']) {
      const v = upstream.headers.get(h);
      if (v) res.set(h, v);
    }
    if (!upstream.body) {
      res.end();
      return;
    }
    // pipeline (unlike .pipe) tears down both sides on error or client disconnect;
    // with .pipe an upstream reset is an unhandled stream error that kills the process.
    pipeline(Readable.fromWeb(upstream.body), res, () => {});
  } catch (e) {
    clearTimeout(timer);
    if (res.headersSent || res.destroyed) {
      res.destroy();
      return;
    }
    const timedOut = e.name === 'AbortError';
    res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'Media request timed out' : 'Could not reach media source', detail: e.message });
  }
}

// Entry point: builds the Xtream stream URL from credentials + stream id, then proxies it.
app.get('/stream', async (req, res) => {
  const { server, username, password, type, id, ext, ua } = req.query;
  if (!server || !username || !password || !type || !id) {
    return res.status(400).json({ error: 'server, username, password, type and id are required' });
  }
  const pathByType = { live: 'live', movie: 'movie', series: 'series' };
  const pathSeg = pathByType[type];
  if (!pathSeg) return res.status(400).json({ error: 'type must be one of live, movie, series' });

  try {
    const base = normalizeServer(server);
    const extension = ext || (type === 'live' ? 'm3u8' : 'mp4');
    const targetUrl = `${base}/${pathSeg}/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${id}.${extension}`;
    await handleMediaProxy(req, res, targetUrl, ua || DEFAULT_UA);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// Used for rewritten playlist entries (absolute URLs already resolved by the server).
app.get('/proxy/media', async (req, res) => {
  const { url, ua } = req.query;
  if (!url) return res.status(400).json({ error: 'url is required' });
  await handleMediaProxy(req, res, url, ua || DEFAULT_UA);
});

// ---------- Show artwork fallback (TVmaze) ----------
// Some providers serve series covers from hosts that are offline. When the provider's
// image fails, the frontend asks here; we match the show on TVmaze (free, keyless) and
// cache results on disk so each show is only looked up once.

const TVMAZE = 'https://api.tvmaze.com';
const ARTWORK_CACHE_FILE = path.join(__dirname, '.artwork-cache.json');
const ARTWORK_MISS_TTL_MS = 7 * 24 * 3600 * 1000;
const TVMAZE_GAP_MS = 300;

let artworkCache = {};
try {
  artworkCache = JSON.parse(fs.readFileSync(ARTWORK_CACHE_FILE, 'utf8'));
} catch {
  artworkCache = {};
}
let artworkSaveTimer = null;
function saveArtworkCache() {
  clearTimeout(artworkSaveTimer);
  artworkSaveTimer = setTimeout(() => {
    fs.writeFile(ARTWORK_CACHE_FILE, JSON.stringify(artworkCache), () => {});
  }, 2000);
}

// TVmaze allows roughly 20 calls / 10s per IP, so calls go out one at a time with a gap.
let tvmazeChain = Promise.resolve();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function tvmaze(pathname) {
  const run = async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);
      try {
        const r = await fetch(TVMAZE + pathname, { signal });
        if (r.status === 429) { await sleep(2000 * (attempt + 1)); continue; }
        if (r.status === 404) return null;
        if (!r.ok) throw new Error(`TVmaze HTTP ${r.status}`);
        return await r.json();
      } finally {
        cancel();
      }
    }
    throw new Error('TVmaze rate limited');
  };
  const p = tvmazeChain.then(run);
  tvmazeChain = p.catch(() => {}).then(() => sleep(TVMAZE_GAP_MS));
  return p;
}

// Optional: with a (free) TMDB API key, shows are matched exactly by the provider's tmdb_id.
// Accepts either a v3 API key or a v4 read access token.
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const TMDB_IMG = 'https://image.tmdb.org/t/p';
async function tmdb(pathname, extraQuery = '') {
  const bearer = TMDB_KEY.length > 40;
  const params = [extraQuery, bearer ? '' : `api_key=${encodeURIComponent(TMDB_KEY)}`].filter(Boolean).join('&');
  const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const r = await fetch(`https://api.themoviedb.org/3${pathname}${params ? `?${params}` : ''}`, {
      headers: bearer ? { Authorization: `Bearer ${TMDB_KEY}` } : {},
      signal,
    });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`TMDB HTTP ${r.status}`);
    return await r.json();
  } finally {
    cancel();
  }
}

// Keyless exact match: Wikidata maps TMDB TV ids (P4983) to TVmaze ids (P8600) and IMDb ids (P345).
const WIKIDATA_API = 'https://www.wikidata.org/w/api.php';
const WIKIDATA_UA = 'iptv-player/1.0 (local IPTV web player; artwork lookup)';
// Wikimedia rate-limits bursts, so these go out one at a time too.
let wikidataChain = Promise.resolve();
function wikidata(params) {
  const run = async () => {
    const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);
    try {
      const r = await fetch(`${WIKIDATA_API}?${new URLSearchParams({ format: 'json', ...params })}`, {
        headers: { 'User-Agent': WIKIDATA_UA },
        signal,
      });
      if (!r.ok) throw new Error(`Wikidata HTTP ${r.status}`);
      return await r.json();
    } finally {
      cancel();
    }
  };
  const p = wikidataChain.then(run);
  wikidataChain = p.catch(() => sleep(5000)).then(() => sleep(250));
  return p;
}

// Lookups are batched: shows requested within a short window share one search and one
// entity fetch (up to 40 ids), which keeps us far below Wikimedia's rate limits.
const WIKIDATA_BATCH = 40;
const wikidataPending = new Map(); // tmdbId -> [{ resolve, reject }]
let wikidataTimer = null;

function wikidataIdsForTmdb(tmdbId) {
  return new Promise((resolve, reject) => {
    const key = String(tmdbId);
    if (!wikidataPending.has(key)) wikidataPending.set(key, []);
    wikidataPending.get(key).push({ resolve, reject });
    if (!wikidataTimer) wikidataTimer = setTimeout(flushWikidata, 400);
  });
}

async function flushWikidata() {
  wikidataTimer = null;
  const batch = [...wikidataPending.entries()].slice(0, WIKIDATA_BATCH);
  batch.forEach(([id]) => wikidataPending.delete(id));
  if (wikidataPending.size) wikidataTimer = setTimeout(flushWikidata, 400);
  const settle = (fn) => batch.forEach(([id, waiters]) => waiters.forEach((w) => fn(w, id)));
  try {
    const search = await wikidata({
      action: 'query', list: 'search', srlimit: '50', srprop: '',
      srsearch: `haswbstatement:${batch.map(([id]) => `P4983=${id}`).join('|')}`,
    });
    const qids = ((search.query && search.query.search) || []).map((x) => x.title);
    const found = {};
    if (qids.length) {
      const ent = await wikidata({ action: 'wbgetentities', ids: qids.join('|'), props: 'claims' });
      Object.values(ent.entities || {}).forEach((e) => {
        const claims = e.claims || {};
        const value = (prop) => {
          const c = (claims[prop] || []).find((x) => x.mainsnak && x.mainsnak.datavalue);
          return c ? c.mainsnak.datavalue.value : null;
        };
        const ids = { tvmaze: value('P8600'), imdb: value('P345') };
        (claims.P4983 || []).forEach((c) => {
          if (c.mainsnak && c.mainsnak.datavalue) found[String(c.mainsnak.datavalue.value)] = ids;
        });
      });
    }
    settle((w, id) => w.resolve(found[id] || null));
  } catch (e) {
    settle((w) => w.reject(e));
  }
}

async function tvmazeShowFromTmdb(tmdbId) {
  const ids = await wikidataIdsForTmdb(tmdbId);
  if (!ids) return null;
  if (ids.tvmaze) return tvmaze(`/shows/${encodeURIComponent(ids.tvmaze)}`);
  return ids.imdb ? tvmaze(`/lookup/shows?imdb=${encodeURIComponent(ids.imdb)}`) : null;
}

app.get('/api/artwork/series', async (req, res) => {
  const name = cleanShowName(req.query.name);
  const yearMatch = /(19|20)\d{2}/.exec(req.query.year || '') || /\(((19|20)\d{2})\)/.exec(req.query.name || '');
  const year = yearMatch ? Number(yearMatch[1] || yearMatch[0]) : null;
  const tmdbId = Number(req.query.tmdb) || null;
  if (!name && !tmdbId) return res.json({ id: null });
  const key = tmdbId ? `${TMDB_KEY ? 't' : 'w'}:${tmdbId}` : `s:${normTitle(name)}:${year || ''}`;
  const hit = artworkCache[key];
  if (hit && (hit.id || Date.now() - hit.at < ARTWORK_MISS_TTL_MS)) return res.json(hit);
  try {
    if (TMDB_KEY && tmdbId) {
      const show = await tmdb(`/tv/${tmdbId}`);
      const entry = {
        id: show ? `tmdb:${tmdbId}` : null,
        poster: show && show.poster_path ? `${TMDB_IMG}/w342${show.poster_path}` : null,
        posterLarge: show && show.poster_path ? `${TMDB_IMG}/w780${show.poster_path}` : null,
        at: Date.now(),
      };
      artworkCache[key] = entry;
      saveArtworkCache();
      return res.json(entry);
    }
    let show = null;
    let lookupFailed = false;
    if (tmdbId) {
      show = await tvmazeShowFromTmdb(tmdbId).catch(() => { lookupFailed = true; return null; });
    }
    if (!show && name) {
      const found = pickShow(await tvmaze(`/search/shows?q=${encodeURIComponent(name)}`), name, year);
      show = found && found.show;
    }
    // A miss caused by an outage or rate limit shouldn't be remembered for a week.
    if (!show && lookupFailed) return res.json({ id: null, poster: null });
    const image = show && show.image;
    const entry = {
      id: show ? show.id : null,
      poster: image ? image.medium || image.original : null,
      posterLarge: image ? image.original || image.medium : null,
      at: Date.now(),
    };
    artworkCache[key] = entry;
    saveArtworkCache();
    res.json(entry);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// Backdrop + per-episode stills for one TVmaze show, keyed "season:episode".
app.get('/api/artwork/show/:id', async (req, res) => {
  const raw = String(req.params.id);
  const tmdbId = raw.startsWith('tmdb:') ? Number(raw.slice(5)) : null;
  const id = tmdbId ? null : Number(raw);
  if (!id && !(tmdbId && TMDB_KEY)) return res.status(400).json({ error: 'bad id' });
  const key = `d:${raw}`;
  const hit = artworkCache[key];
  if (hit && Date.now() - hit.at < ARTWORK_MISS_TTL_MS) return res.json(hit);
  try {
    if (tmdbId) {
      const show = await tmdb(`/tv/${tmdbId}`);
      const seasons = ((show && show.seasons) || []).map((x) => x.season_number).filter((n) => n > 0).slice(0, 20);
      const full = seasons.length ? await tmdb(`/tv/${tmdbId}`, `append_to_response=${seasons.map((n) => `season/${n}`).join(',')}`) : null;
      const stills = {};
      seasons.forEach((n) => {
        ((full && full[`season/${n}`] && full[`season/${n}`].episodes) || []).forEach((ep) => {
          if (ep.still_path) stills[`${n}:${ep.episode_number}`] = `${TMDB_IMG}/w300${ep.still_path}`;
        });
      });
      const entry = { backdrop: show && show.backdrop_path ? `${TMDB_IMG}/w1280${show.backdrop_path}` : null, episodes: stills, at: Date.now() };
      artworkCache[key] = entry;
      saveArtworkCache();
      return res.json(entry);
    }
    const [images, episodes] = await Promise.all([
      tvmaze(`/shows/${id}/images`),
      tvmaze(`/shows/${id}/episodes`),
    ]);
    const bg = (images || []).filter((i) => i.type === 'background').sort((a, b) => Number(b.main) - Number(a.main))[0];
    const stills = {};
    (episodes || []).forEach((ep) => {
      if (ep.image) stills[`${ep.season}:${ep.number}`] = ep.image.medium || ep.image.original;
    });
    const entry = {
      backdrop: bg ? (bg.resolutions.original || bg.resolutions.medium || {}).url || null : null,
      episodes: stills,
      at: Date.now(),
    };
    artworkCache[key] = entry;
    saveArtworkCache();
    res.json(entry);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

// ---------- Guide index, match finder and Sport Center ----------
// The server builds an index of the provider's guide for the sports channels (see
// lib/guide-index.js) and joins it with fixtures from ESPN / MotoGP.

const GUIDE_LIST_TIMEOUT_MS = 60000;
const XMLTV_HEADERS_TIMEOUT_MS = 60000;
const XMLTV_TOTAL_TIMEOUT_MS = 240000;
const guideStore = createGuideStore({ dir: path.join(__dirname, '.guide-cache') });

// What the guide store needs to (re)build one account's index. Credentials stay in
// these closures for the length of the build only.
function guideSource(q) {
  const base = normalizeServer(q.server);
  const ua = q.ua || DEFAULT_UA;
  const playerApi = async (params) => {
    const { signal, cancel } = withTimeout(GUIDE_LIST_TIMEOUT_MS);
    try {
      const qs = new URLSearchParams({ username: q.username, password: q.password, ...params });
      const r = await fetch(`${base}/player_api.php?${qs}`, { headers: { 'User-Agent': ua }, signal });
      if (!r.ok) throw new Error(`Provider responded with HTTP ${r.status}`);
      return await r.json();
    } finally {
      cancel();
    }
  };
  const xmltv = async () => {
    const controller = new AbortController();
    const headers = setTimeout(() => controller.abort(), XMLTV_HEADERS_TIMEOUT_MS);
    setTimeout(() => controller.abort(), XMLTV_TOTAL_TIMEOUT_MS).unref();
    try {
      const qs = new URLSearchParams({ username: q.username, password: q.password });
      return await fetch(`${base}/xmltv.php?${qs}`, { headers: { 'User-Agent': ua }, signal: controller.signal });
    } finally {
      clearTimeout(headers);
    }
  };
  const extraIds = String(q.ids || '').split(',').filter(Boolean).slice(0, 500);
  return { key: indexKey(base, q.username), playerApi, xmltv, extraIds };
}

function requireCreds(req, res) {
  const { server, username, password } = req.query;
  if (server && username && password) return true;
  res.status(400).json({ error: 'server, username and password are required' });
  return false;
}

const guideInfo = (index, source) => ({
  builtAt: index ? index.builtAt : null,
  source: index ? index.source : null,
  // The guide's last programme: later matches can only be best guesses.
  until: index && index.programmes.length ? index.programmes.reduce((m, p) => Math.max(m, p.end), 0) : null,
  building: guideStore.isBuilding(source.key),
  error: guideStore.lastError(source.key),
});

app.get('/api/guide/status', async (req, res) => {
  if (!requireCreds(req, res)) return;
  try {
    const source = guideSource(req.query);
    const index = await guideStore.get(source);
    res.json({
      ...guideInfo(index, source),
      channels: index ? Object.keys(index.channels).length : 0,
      programmes: index ? index.programmes.length : 0,
      stats: index ? index.stats : null,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/guide/search', async (req, res) => {
  if (!requireCreds(req, res)) return;
  try {
    const source = guideSource(req.query);
    const index = await guideStore.get(source);
    res.json({ ...guideInfo(index, source), results: searchGuide(index, String(req.query.q || '')) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const listParam = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean);

app.get('/api/sports/home', async (req, res) => {
  if (!requireCreds(req, res)) return;
  try {
    const now = Date.now();
    const source = guideSource(req.query);
    const leagues = req.query.leagues ? listParam(req.query.leagues) : sports.LEAGUES.map((l) => l.id);
    const [espn, motogp, index] = await Promise.all([
      sports.fetchEvents(leagues, now),
      leagues.includes('motogp') ? fetchMotoGpEvents(now).catch((e) => { console.log(`[sports] MotoGP: ${e.message}`); return []; }) : [],
      guideStore.get(source),
    ]);
    const events = [...espn.events, ...motogp];
    const starts = events.map((e) => e.start);
    const programmes = programmesBetween(index, Math.min(...starts) - 12 * 3600e3, Math.max(...starts) + 3600e3);
    const matched = matchEvents(events, programmes);
    events.forEach((ev) => {
      const found = matched.get(ev.id) || [];
      // Found only on foreign channels: the likely local ones follow, labelled as guesses.
      const local = found.some((w) => isHomeChannel(w.channel));
      const guesses = !local && index ? guessChannels(ev, index.streams, found.length ? 2 : 6) : [];
      ev.where = [...found, ...guesses].map((w) => ({ ...w, foreign: isHomeChannel(w.channel) ? '' : countryOf(w.channel) }));
    });
    const ranked = rankEvents(events, {
      now,
      teams: String(req.query.teams || '').split('|').filter(Boolean),
      spanishAthletes: req.query.athletes !== '0',
    });
    res.json({ ...ranked, guide: guideInfo(index, source), errors: espn.errors, leagues: sports.leagueCatalog() });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

function listen() {
  if (HOST) {
    app.listen(PORT, HOST, () => console.log(`IPTV player running at http://${HOST}:${PORT}`));
    return;
  }
  // "localhost" may resolve to either loopback address, so listen on both.
  app.listen(PORT, '127.0.0.1', () => console.log(`IPTV player running at http://localhost:${PORT}`));
  app.listen(PORT, '::1').on('error', () => {}); // no IPv6 loopback: IPv4 is enough
}

if (require.main === module) listen();

module.exports = { app };
