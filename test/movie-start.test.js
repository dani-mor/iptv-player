// Faster movie start: going straight to a remembered VOD edge, and starting the tail
// download from the first bytes of the file. No network: global fetch is stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable, Writable, pipeline } = require('node:stream');
const { fetchViaEdge } = require('../lib/edges');
const { tailPrefetcher, knownTail, sendTail } = require('../lib/tail');

const withFetch = async (stub, fn) => {
  const real = global.fetch;
  global.fetch = stub;
  try {
    await fn();
  } finally {
    global.fetch = real;
  }
};

const response = (url, { status = 206, redirected = false } = {}) => ({
  url, status, ok: status >= 200 && status < 300, redirected, body: { cancel: async () => {} },
});

test('fetchViaEdge goes straight to the edge it was redirected to last time', async () => {
  const file = 'http://provider/movie/u/p/1.mp4';
  const edge = 'http://edge-a/movie/1.mp4?token=x';
  const original = [];
  const direct = [];
  const fetchFile = async (url) => { original.push(url); return response(edge, { redirected: true }); };
  await withFetch(async (url) => { direct.push(url); return response(url); }, async () => {
    assert.equal((await fetchViaEdge(file, {}, fetchFile)).url, edge);
    assert.equal((await fetchViaEdge(file, {}, fetchFile)).url, edge);
    assert.deepEqual(original, [file]);
    assert.deepEqual(direct, [edge]);
  });
});

test('fetchViaEdge asks the original URL again when the edge fails', async () => {
  const file = 'http://provider/movie/u/p/2.mp4';
  let edge = 'http://edge-a/movie/2.mp4?token=old';
  const original = [];
  const fetchFile = async (url) => { original.push(url); return response(edge, { redirected: true }); };
  await withFetch(async () => response('', { status: 403 }), async () => {
    await fetchViaEdge(file, {}, fetchFile);
    edge = 'http://edge-b/movie/2.mp4?token=new';
    assert.equal((await fetchViaEdge(file, {}, fetchFile)).url, edge);
    assert.equal(original.length, 2);
  });
  // A network error on the edge falls back the same way, and the new edge is remembered.
  await withFetch(async (url) => {
    if (url.startsWith('http://edge-b')) throw new TypeError('fetch failed');
    return response(url);
  }, async () => {
    edge = 'http://edge-c/movie/2.mp4?token=newer';
    assert.equal((await fetchViaEdge(file, {}, fetchFile)).url, edge);
    assert.equal(original.length, 3);
    assert.equal((await fetchViaEdge(file, {}, fetchFile)).url, edge);
    assert.equal(original.length, 3);
  });
});

test('fetchViaEdge remembers nothing when the file was not redirected', async () => {
  const file = 'http://provider/movie/u/p/3.mp4';
  let calls = 0;
  const fetchFile = async (url) => { calls += 1; return response(url); };
  await withFetch(async () => assert.fail('no edge to go to'), async () => {
    await fetchViaEdge(file, {}, fetchFile);
    await fetchViaEdge(file, {}, fetchFile);
    assert.equal(calls, 2);
  });
});

// The start of an mp4 whose index (moov) sits after the media data.
function mp4Head(mdatEnd) {
  const ftyp = Buffer.alloc(32);
  ftyp.writeUInt32BE(32, 0);
  ftyp.write('ftyp', 4, 'latin1');
  const mdat = Buffer.alloc(64);
  mdat.writeUInt32BE(mdatEnd - 32, 0);
  mdat.write('mdat', 4, 'latin1');
  return Buffer.concat([ftyp, mdat]);
}

const upstreamFor = (url, total, range = `bytes 0-${total - 1}/${total}`) => ({
  url,
  status: 206,
  headers: { get: (h) => ({ 'content-range': range, 'content-type': 'video/mp4' })[h] ?? null },
});

const drain = (res) => new Promise((resolve) => {
  const sink = new Writable({ write(_c, _e, cb) { cb(); } });
  sink.status = () => sink;
  sink.set = () => {};
  sink.on('finish', resolve);
  return res(sink);
});

test('tailPrefetcher starts the tail download from the first bytes of the file', async () => {
  const url = 'http://provider/movie/u/p/4.mp4';
  const total = 100 * 1024 * 1024;
  const start = total - 3 * 1024 * 1024; // a 32 KiB boundary
  const head = mp4Head(start + 100);
  const ranges = [];
  await withFetch(async (_url, { headers }) => {
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(headers.Range).map(Number);
    ranges.push([a, b]);
    return { status: 206, arrayBuffer: async () => new ArrayBuffer(b - a + 1) };
  }, async () => {
    assert.equal(knownTail(url, `bytes=${start}-`), null);
    const prefetch = tailPrefetcher('bytes=0-', upstreamFor(url, total), url, 'ua');
    const passed = [];
    await new Promise((resolve, reject) => pipeline(
      Readable.from([head.subarray(0, 20), head.subarray(20)]),
      prefetch,
      new Writable({ write(c, _e, cb) { passed.push(c); cb(); } }),
      (err) => (err ? reject(err) : resolve()),
    ));
    // The bytes go through untouched, and the browser's tail request is now covered.
    assert.deepEqual(Buffer.concat(passed), head);
    const known = knownTail(url, `bytes=${start}-`);
    assert.ok(known);
    assert.equal(known.entry.start, start);
    await drain((sink) => sendTail(sink, known, new AbortController().signal));
    assert.equal(Math.min(...ranges.map((r) => r[0])), start);
    assert.equal(Math.max(...ranges.map((r) => r[1])), total - 1);
  });
});

test('tailPrefetcher only looks at requests from the start of the file', () => {
  const url = 'http://provider/movie/u/p/5.mp4';
  const total = 100 * 1024 * 1024;
  assert.equal(tailPrefetcher('bytes=1000-', upstreamFor(url, total, `bytes 1000-${total - 1}/${total}`), url, 'ua'), null);
  assert.equal(tailPrefetcher(undefined, { ...upstreamFor(url, total), status: 200 }, url, 'ua'), null);
});
