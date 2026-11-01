// ---------- Faster movie start ----------
// The provider caps each connection at ~0.6 MB/s, and many movie files keep their index
// (the mp4 "moov" box) at the very end. Before playing, the browser fetches that tail
// (often 3-10 MB) in one request, which took 5-30s. When a request asks for the tail of
// a file, fetch it as a few parallel ranges instead and stream them back in order.
//
// Each file's tail is downloaded once and shared. The browser often drops its first tail
// request a moment in and asks again from a slightly later offset (it won't wait for bytes
// that far ahead of what has arrived), so every request that starts inside a known tail is
// served from the same download, without another round trip to the provider. The download
// carries on when a request is dropped, and finished tails are kept so reopening or
// resuming a movie starts at once.
//
// The tail download doesn't even wait for the browser to ask: the first bytes of the file
// say whether the index comes after the media data, and where.

const { Transform } = require('stream');

const REQUEST_TIMEOUT_MS = 20000;
const TAIL_MIN_CHUNK = 512 * 1024;
const TAIL_PARALLEL = 4;
const TAIL_MIN = 2 * 1024 * 1024;
const TAIL_MAX = 64 * 1024 * 1024;
const TAIL_CACHE_MAX = 128 * 1024 * 1024;
// Kept tails are trusted without asking the provider, so don't trust them forever.
const TAIL_TTL_MS = 60 * 60 * 1000;
// Chrome fetches media in 32 KiB blocks, so its tail request starts on a block boundary.
const BROWSER_BLOCK = 32 * 1024;
const HEAD_SNIFF_MAX = 64 * 1024;
const tails = new Map(); // cacheUrl -> { start, total, contentType, ranges, parts, bytes, at }
let tailBytes = 0;

function forget(cacheUrl, entry) {
  if (tails.get(cacheUrl) !== entry) return;
  tails.delete(cacheUrl);
  tailBytes -= entry.bytes;
}

function remember(cacheUrl, entry) {
  const old = tails.get(cacheUrl);
  if (old) forget(cacheUrl, old);
  tails.set(cacheUrl, entry);
  tailBytes += entry.bytes;
  for (const [k, v] of tails) {
    if (tailBytes <= TAIL_CACHE_MAX || v === entry) break;
    forget(k, v);
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

// Walks the top-level boxes at the start of an mp4. When the index (moov) comes after the
// media data (mdat), returns where the browser will ask for the tail; null when there is
// nothing to fetch ahead, undefined when `head` is too short to tell yet.
function tailStartFromHead(head, total) {
  let pos = 0;
  while (pos + 8 <= head.length) {
    const type = head.toString('latin1', pos + 4, pos + 8);
    if (pos === 0 && type !== 'ftyp') return null; // not an mp4
    let size = head.readUInt32BE(pos);
    if (size === 1) {
      if (pos + 16 > head.length) return undefined;
      size = Number(head.readBigUInt64BE(pos + 8));
    }
    if (type === 'moov' || size === 0) return null; // index first, or media data to the end
    if (size < 8) return null;
    if (type === 'mdat') {
      const start = Math.floor((pos + size) / BROWSER_BLOCK) * BROWSER_BLOCK;
      const tailSize = total - start;
      return tailSize >= TAIL_MIN && tailSize <= TAIL_MAX ? start : null;
    }
    pos += size;
  }
  return pos < HEAD_SNIFF_MAX ? undefined : null;
}

// For a request from the start of a movie: a pass-through stream that starts the tail
// download as soon as the file's first bytes show it will be needed. Null otherwise.
function tailPrefetcher(rangeHeader, upstream, cacheUrl, ua) {
  const cr = /^bytes 0-\d+\/(\d+)$/.exec(upstream.headers.get('content-range') || '');
  if (rangeHeader !== 'bytes=0-' || upstream.status !== 206 || !cr) return null;
  const total = Number(cr[1]);
  let head = Buffer.alloc(0);
  return new Transform({
    transform(chunk, _enc, cb) {
      if (head) {
        head = Buffer.concat([head, chunk]);
        const start = tailStartFromHead(head, total);
        if (start !== undefined || head.length >= HEAD_SNIFF_MAX) {
          head = null;
          if (start) {
            const contentType = upstream.headers.get('content-type');
            startTail(upstream.url || cacheUrl, cacheUrl, ua, { start, end: total - 1, total }, contentType);
          }
        }
      }
      cb(null, chunk);
    },
  });
}

// A tail we already have (or are fetching) that covers this open-ended request:
// { entry, from } for sendTail, or null.
function knownTail(cacheUrl, rangeHeader) {
  const req = /^bytes=(\d+)-$/.exec(rangeHeader || '');
  const entry = tails.get(cacheUrl);
  if (!req || !entry) return null;
  if (Date.now() - entry.at > TAIL_TTL_MS) {
    forget(cacheUrl, entry);
    return null;
  }
  const from = Number(req[1]);
  return from >= entry.start && from < entry.total ? { entry, from } : null;
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

// Starts downloading a file's tail as parallel ranges (or joins the download already
// covering it) and returns the shared entry. The download isn't tied to any one request.
function startTail(fetchUrl, cacheUrl, ua, { start, end, total }, contentType) {
  const known = tails.get(cacheUrl);
  if (known && known.total === total && known.start <= start) return known;

  const ranges = [];
  // One round of equal parts: each range request costs ~0.7s before data flows.
  const chunk = Math.max(TAIL_MIN_CHUNK, Math.ceil((end - start + 1) / TAIL_PARALLEL));
  for (let a = start; a <= end; a += chunk) ranges.push([a, Math.min(end, a + chunk - 1)]);
  const settle = [];
  const parts = ranges.map(() => new Promise((resolve, reject) => settle.push({ resolve, reject })));
  parts.forEach((p) => p.catch(() => {})); // failures surface in sendTail
  const entry = { start, total, contentType, ranges, parts, bytes: end - start + 1, at: Date.now() };
  remember(cacheUrl, entry);

  const controller = new AbortController();
  let next = 0;
  const worker = async () => {
    while (next < ranges.length && !controller.signal.aborted) {
      const i = next++;
      settle[i].resolve(await fetchRange(fetchUrl, ua, ranges[i][0], ranges[i][1], controller.signal));
    }
  };
  Promise.all(Array.from({ length: TAIL_PARALLEL }, worker)).catch((e) => {
    controller.abort();
    forget(cacheUrl, entry);
    settle.forEach((s) => s.reject(e));
  });
  return entry;
}

// Streams the tail from byte `from` to the end, writing each part as soon as it and every
// part before it have arrived. `signal` is this request's: the download itself carries on.
async function sendTail(res, { entry, from }, signal) {
  const { ranges, parts, total, contentType } = entry;
  res.status(206);
  res.set({
    'Content-Type': contentType || 'video/mp4',
    'Content-Length': String(total - from),
    'Content-Range': `bytes ${from}-${total - 1}/${total}`,
    'Accept-Ranges': 'bytes',
  });
  try {
    for (let i = 0; i < ranges.length; i++) {
      const [a, b] = ranges[i];
      if (b < from) continue;
      const buf = await parts[i];
      if (signal.aborted || res.destroyed) return;
      if (!res.write(a < from ? buf.subarray(from - a) : buf)) {
        await new Promise((r) => { res.once('drain', r); res.once('close', r); });
      }
    }
    res.end();
  } catch {
    res.destroy();
  }
}

module.exports = { movieTailRange, knownTail, startTail, sendTail, tailStartFromHead, tailPrefetcher, TAIL_MIN, TAIL_MAX };
