const test = require('node:test');
const assert = require('node:assert/strict');
const { rewritePlaylist, isPlaylistUrl } = require('../lib/playlist');
const { Writable } = require('node:stream');
const { movieTailRange, knownTail, startTail, sendTail, tailStartFromHead, TAIL_MIN, TAIL_MAX } = require('../lib/tail');
const { cleanShowName, normTitle, pickShow } = require('../lib/titles');

const unproxy = (line) => decodeURIComponent(/url=([^&]+)/.exec(line)[1]);

test('rewritePlaylist routes segments, variants and keys through the proxy', () => {
  const text = [
    '#EXTM3U',
    '#EXT-X-KEY:METHOD=AES-128,URI="key.bin"',
    '#EXTINF:10.0,',
    'seg-101.ts',
    '',
    '#EXTINF:10.0,',
    'http://edge2.example.com/hls/seg-102.ts?token=abc',
  ].join('\n');
  const out = rewritePlaylist(text, 'http://edge1.example.com/hls/live.m3u8', 'VLC').split('\n');
  assert.equal(out[0], '#EXTM3U');
  assert.match(out[1], /^#EXT-X-KEY:METHOD=AES-128,URI="\/proxy\/media\?url=/);
  assert.equal(unproxy(out[1]), 'http://edge1.example.com/hls/key.bin');
  assert.equal(unproxy(out[3]), 'http://edge1.example.com/hls/seg-101.ts');
  assert.match(out[3], /&ua=VLC$/);
  assert.equal(out[4], '');
  assert.equal(unproxy(out[6]), 'http://edge2.example.com/hls/seg-102.ts?token=abc');
});

test('isPlaylistUrl', () => {
  assert.ok(isPlaylistUrl('http://x/live/1.m3u8'));
  assert.ok(isPlaylistUrl('http://x/live/1.m3u8?token=1'));
  assert.ok(!isPlaylistUrl('http://x/live/1.ts'));
});

const upstream = (status, contentRange) => ({ status, headers: { get: (h) => (h === 'content-range' ? contentRange : null) } });

test('movieTailRange only takes open-ended requests for the end of a file', () => {
  const total = 1_000_000_000;
  const start = total - 5 * 1024 * 1024;
  assert.deepEqual(
    movieTailRange(`bytes=${start}-`, upstream(206, `bytes ${start}-${total - 1}/${total}`)),
    { start, end: total - 1, total },
  );
  // From the beginning: normal playback, not a tail.
  assert.equal(movieTailRange('bytes=0-', upstream(206, `bytes 0-${total - 1}/${total}`)), null);
  // Closed range, wrong status, too small or too big.
  assert.equal(movieTailRange(`bytes=${start}-${start + 10}`, upstream(206, `bytes ${start}-${start + 10}/${total}`)), null);
  assert.equal(movieTailRange(`bytes=${start}-`, upstream(200, null)), null);
  const small = total - (TAIL_MIN - 1);
  assert.equal(movieTailRange(`bytes=${small}-`, upstream(206, `bytes ${small}-${total - 1}/${total}`)), null);
  const big = total - (TAIL_MAX + 1);
  assert.equal(movieTailRange(`bytes=${big}-`, upstream(206, `bytes ${big}-${total - 1}/${total}`)), null);
});

test('a movie tail is downloaded once and shared by later requests inside it', async () => {
  const total = 50 * 1024 * 1024;
  const start = total - 3 * 1024 * 1024;
  const file = Buffer.alloc(total - start, 0);
  for (let i = 0; i < file.length; i++) file[i] = i % 251;
  const realFetch = global.fetch;
  let calls = 0;
  global.fetch = async (url, { headers }) => {
    calls += 1;
    const [, a, b] = /bytes=(\d+)-(\d+)/.exec(headers.Range).map(Number);
    return { status: 206, arrayBuffer: async () => file.subarray(a - start, b - start + 1) };
  };
  const collect = () => {
    const chunks = [];
    const res = new Writable({ write(c, _e, cb) { chunks.push(c); cb(); } });
    res.status = () => res;
    res.set = (h) => { res.headers = h; };
    res.done = new Promise((r) => res.on('finish', () => r(Buffer.concat(chunks))));
    return res;
  };
  try {
    const url = 'http://edge/movie/1.mp4';
    const entry = startTail(url, url, 'ua', { start, end: total - 1, total }, 'video/mp4');
    const first = collect();
    await sendTail(first, { entry, from: start }, new AbortController().signal);
    assert.deepEqual(await first.done, file);

    // The browser re-asks from a little further in: same download, no new requests.
    const before = calls;
    const later = knownTail(url, `bytes=${start + 360448}-`);
    assert.ok(later);
    const second = collect();
    await sendTail(second, later, new AbortController().signal);
    assert.deepEqual(await second.done, file.subarray(360448));
    assert.equal(second.headers['Content-Range'], `bytes ${start + 360448}-${total - 1}/${total}`);
    assert.equal(calls, before);

    assert.equal(knownTail(url, `bytes=${start - 1}-`), null);
    assert.equal(knownTail(url, 'bytes=0-'), null);
    assert.equal(knownTail('http://edge/movie/2.mp4', `bytes=${start}-`), null);
  } finally {
    global.fetch = realFetch;
  }
});

const box = (type, size, body = Buffer.alloc(0)) => {
  const b = Buffer.alloc(8 + body.length);
  b.writeUInt32BE(size, 0);
  b.write(type, 4, 'latin1');
  body.copy(b, 8);
  return b;
};

test('tailStartFromHead finds an index after the media data', () => {
  const total = 736_741_758;
  const ftyp = box('ftyp', 32, Buffer.alloc(24));
  const free = box('free', 8);
  // mdat ends at 732_266_500: Chrome asks from the 32 KiB block holding that byte.
  const mdat = box('mdat', 732_266_500 - 40);
  assert.equal(tailStartFromHead(Buffer.concat([ftyp, free, mdat]), total), 732_266_496);

  // 64-bit mdat size.
  const big = Buffer.alloc(16);
  big.writeUInt32BE(1, 0);
  big.write('mdat', 4, 'latin1');
  big.writeBigUInt64BE(BigInt(732_266_500 - 32), 8);
  assert.equal(tailStartFromHead(Buffer.concat([ftyp, big]), total), 732_266_496);
  assert.equal(tailStartFromHead(Buffer.concat([ftyp, big.subarray(0, 12)]), total), undefined);

  // Index first (faststart), media data to the end, not an mp4, or a tail too big to prefetch.
  assert.equal(tailStartFromHead(Buffer.concat([ftyp, box('moov', 5000)]), total), null);
  assert.equal(tailStartFromHead(Buffer.concat([ftyp, box('mdat', 0)]), total), null);
  assert.equal(tailStartFromHead(Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n'), total), null);
  assert.equal(tailStartFromHead(Buffer.concat([ftyp, box('mdat', 1000)]), total), null);
  // Not enough bytes yet.
  assert.equal(tailStartFromHead(ftyp, total), undefined);
});

test('cleanShowName strips provider decoration', () => {
  assert.equal(cleanShowName('|ES| La Casa de Papel (2017) [4K]'), 'La Casa de Papel');
  assert.equal(cleanShowName('ES - Narcos FHD'), 'Narcos');
  assert.equal(cleanShowName('Payback (2023)'), 'Payback');
});

test('normTitle folds accents and punctuation', () => {
  assert.equal(normTitle('Élite: Historias Breves & Más'), 'elite historias breves and mas');
});

test('pickShow prefers a year match, else needs an exact title', () => {
  const results = [
    { score: 0.9, show: { name: 'Dark Matter', premiered: '2015-06-12' } },
    { score: 0.7, show: { name: 'Dark', premiered: '2017-12-01' } },
  ];
  assert.equal(pickShow(results, 'Dark', 2017).show.name, 'Dark');
  assert.equal(pickShow(results, 'Dark', null).show.name, 'Dark');
  assert.equal(pickShow(results, 'Something Else', null), null);
});
