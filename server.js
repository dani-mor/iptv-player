const express = require('express');
const path = require('path');
const { Readable } = require('stream');

const app = express();
const PORT = process.env.PORT || 4040;
const DEFAULT_UA = 'IPTVSmartersPlayer';
const REQUEST_TIMEOUT_MS = 20000;

app.use(express.static(path.join(__dirname, 'public')));

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

// Rewrites an HLS playlist so every segment / variant / key URI is routed back through our proxy,
// since the browser cannot attach the provider's required User-Agent header itself.
function rewritePlaylist(text, baseUrl, ua) {
  const proxied = (absoluteUrl) => `/proxy/media?url=${encodeURIComponent(absoluteUrl)}&ua=${encodeURIComponent(ua)}`;

  const lines = text.split(/\r?\n/).map((line) => {
    if (line.startsWith('#')) {
      return line.replace(/URI="([^"]+)"/g, (match, uri) => {
        try {
          const abs = new URL(uri, baseUrl).toString();
          return `URI="${proxied(abs)}"`;
        } catch {
          return match;
        }
      });
    }
    const trimmed = line.trim();
    if (!trimmed) return line;
    try {
      const abs = new URL(trimmed, baseUrl).toString();
      return proxied(abs);
    } catch {
      return line;
    }
  });
  return lines.join('\n');
}

async function handleMediaProxy(req, res, targetUrl, ua) {
  const { signal, cancel } = withTimeout(REQUEST_TIMEOUT_MS);
  try {
    const headers = { 'User-Agent': ua || DEFAULT_UA };
    if (req.headers.range) headers['Range'] = req.headers.range;

    const upstream = await fetch(targetUrl, { headers, redirect: 'follow', signal });
    const contentType = upstream.headers.get('content-type') || '';
    const looksLikePlaylist = contentType.includes('mpegurl') || /\.m3u8(\?|$)/i.test(targetUrl);

    if (looksLikePlaylist) {
      const text = await upstream.text();
      const rewritten = rewritePlaylist(text, upstream.url || targetUrl, ua);
      res.status(upstream.status);
      res.set('Content-Type', 'application/vnd.apple.mpegurl');
      res.set('Cache-Control', 'no-cache');
      res.send(rewritten);
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
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (e) {
    if (!res.headersSent) {
      const timedOut = e.name === 'AbortError';
      res.status(timedOut ? 504 : 502).json({ error: timedOut ? 'Media request timed out' : 'Could not reach media source', detail: e.message });
    } else {
      res.end();
    }
  } finally {
    cancel();
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

app.listen(PORT, () => {
  console.log(`IPTV player running at http://localhost:${PORT}`);
});
