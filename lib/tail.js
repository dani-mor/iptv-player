// ---------- Faster movie start ----------
// The provider caps each connection at ~0.6 MB/s, and many movie files keep their index
// (the mp4 "moov" box) at the very end. Before playing, the browser fetches that tail
// (often 3-10 MB) in one request, which took 5-30s. When a request asks for the tail of
// a file, fetch it as a few parallel ranges instead and stream them back in order.
// Recent tails are cached so reopening or resuming a movie starts at once.

const REQUEST_TIMEOUT_MS = 20000;
const TAIL_MIN_CHUNK = 512 * 1024;
const TAIL_PARALLEL = 4;
const TAIL_MIN = 2 * 1024 * 1024;
const TAIL_MAX = 64 * 1024 * 1024;
const TAIL_CACHE_MAX = 128 * 1024 * 1024;
const tailCache = new Map(); // `${targetUrl}|${start}` -> { buf, total }
let tailCacheBytes = 0;

function rememberTail(key, entry) {
  if (tailCache.has(key)) return;
  tailCache.set(key, entry);
  tailCacheBytes += entry.buf.length;
  for (const [k, v] of tailCache) {
    if (tailCacheBytes <= TAIL_CACHE_MAX) break;
    tailCache.delete(k);
    tailCacheBytes -= v.buf.length;
  }
}

// Returns { start, end, total } for an open-ended range request near the end of a file.
// `upstream` only needs `status` and `headers.get()`.
function movieTailRange(rangeHeader, upstream) {
  const req = /^bytes=(\d+)-$/.exec(rangeHeader || '');
  const cr = /bytes (\d+)-(\d+)\/(\d+)/.exec(upstream.headers.get('content-range') || '');
  if (!req || !cr || upstream.status !== 206) return null;
  const start = Number(req[1]);
  const total = Number(cr[3]);
  const size = total - start;
  if (start === 0 || size < TAIL_MIN || size > TAIL_MAX) return null;
  return { start, end: total - 1, total };
}

async function fetchRange(url, ua, from, to, signal) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, {
        headers: { 'User-Agent': ua, Range: `bytes=${from}-${to}` },
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
      if (r.status !== 206) throw new Error(`HTTP ${r.status}`);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length !== to - from + 1) throw new Error('short read');
      return buf;
    } catch (e) {
      if (signal.aborted || attempt >= 2) throw e;
    }
  }
}

async function sendTailInParallel(res, fetchUrl, cacheUrl, ua, { start, end, total }, contentType, signal) {
  res.status(206);
  res.set({
    'Content-Type': contentType || 'video/mp4',
    'Content-Length': String(end - start + 1),
    'Content-Range': `bytes ${start}-${end}/${total}`,
    'Accept-Ranges': 'bytes',
  });

  const key = `${cacheUrl}|${start}`;
  const cached = tailCache.get(key);
  if (cached && cached.total === total) {
    res.end(cached.buf);
    return;
  }

  const ranges = [];
  // One round of equal parts: each range request costs ~0.7s before data flows.
  const chunk = Math.max(TAIL_MIN_CHUNK, Math.ceil((end - start + 1) / TAIL_PARALLEL));
  for (let a = start; a <= end; a += chunk) ranges.push([a, Math.min(end, a + chunk - 1)]);
  const done = new Map();
  const parts = [];
  let nextToFetch = 0;
  let nextToWrite = 0;
  let flushing = false;

  // Writes finished chunks strictly in order, waiting for the client to drain.
  const flush = async () => {
    if (flushing) return;
    flushing = true;
    while (done.has(nextToWrite)) {
      const buf = done.get(nextToWrite);
      done.delete(nextToWrite);
      parts.push(buf);
      nextToWrite += 1;
      if (!res.write(buf)) await new Promise((r) => res.once('drain', r));
    }
    flushing = false;
  };

  const worker = async () => {
    while (nextToFetch < ranges.length && !signal.aborted) {
      const i = nextToFetch++;
      done.set(i, await fetchRange(fetchUrl, ua, ranges[i][0], ranges[i][1], signal));
      await flush();
    }
  };

  try {
    await Promise.all(Array.from({ length: TAIL_PARALLEL }, worker));
    await flush();
    res.end();
    rememberTail(key, { buf: Buffer.concat(parts), total });
  } catch {
    res.destroy();
  }
}

module.exports = { movieTailRange, sendTailInParallel, TAIL_MIN, TAIL_MAX };
