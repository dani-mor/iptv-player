const test = require('node:test');
const assert = require('node:assert/strict');
const { rewritePlaylist, isPlaylistUrl } = require('../lib/playlist');
const { movieTailRange, TAIL_MIN, TAIL_MAX } = require('../lib/tail');
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
