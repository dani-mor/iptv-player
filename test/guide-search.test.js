const test = require('node:test');
const assert = require('node:assert/strict');
const { searchGuide, sportsStreams, channelMap } = require('../lib/guide-index');

const H = 3600e3;
const NOW = Date.UTC(2026, 10, 1, 20, 0);

const index = {
  channels: {
    'mlaliga.es': { streams: [{ stream_id: 1, name: 'ES: M+ LaLiga FHD' }, { stream_id: 2, name: 'ES: M+ LaLiga HD' }] },
    'dazn.es': { streams: [{ stream_id: 3, name: 'DAZN LALIGA FHD' }] },
  },
  programmes: [
    { channel: 'mlaliga.es', start: NOW - H, end: NOW + H, title: '(EN DIRECTO) Villarreal CF - RCD Espanyol de Barcelona - LALIGA EA SPORTS', desc: '' },
    { channel: 'dazn.es', start: NOW + 2 * H, end: NOW + 4 * H, title: 'LALIGA HYPERMOTION T26/27 · Jornada 12: SD Eibar - UD Almería', desc: 'Desde Ipurúa' },
    { channel: 'dazn.es', start: NOW + H, end: NOW + 2 * H, title: 'Resúmenes LALIGA HyperMotion T26/27 · Jornada 12: Celta Fortuna - Córdoba', desc: '' },
    { channel: 'mlaliga.es', start: NOW - 4 * H, end: NOW - 2 * H, title: 'Barcelona TV: magazine', desc: '' },
    { channel: 'mlaliga.es', start: NOW - 10 * H, end: NOW - 8 * H, title: 'Barcelona old', desc: '' },
  ],
};

test('search folds accents and needs every word', () => {
  assert.deepEqual(searchGuide(index, 'almeria', NOW).map((r) => r.title), ['LALIGA HYPERMOTION T26/27 · Jornada 12: SD Eibar - UD Almería']);
  assert.deepEqual(searchGuide(index, 'eibar almería', NOW).length, 1);
  assert.deepEqual(searchGuide(index, 'eibar betis', NOW).length, 0);
  assert.deepEqual(searchGuide(index, 'ipurua', NOW).length, 1); // description
  assert.deepEqual(searchGuide(index, '', NOW), []);
});

test('search matches word starts, not the middle of words', () => {
  assert.equal(searchGuide(index, 'espan', NOW).length, 1);
  assert.equal(searchGuide(index, 'panyol', NOW).length, 0);
});

test('order: on now, then upcoming by start, then the recent past; old ones dropped', () => {
  const titles = searchGuide(index, 'laliga', NOW).map((r) => r.title);
  assert.deepEqual(titles, [
    '(EN DIRECTO) Villarreal CF - RCD Espanyol de Barcelona - LALIGA EA SPORTS',
    'Resúmenes LALIGA HyperMotion T26/27 · Jornada 12: Celta Fortuna - Córdoba',
    'LALIGA HYPERMOTION T26/27 · Jornada 12: SD Eibar - UD Almería',
  ]);
  assert.deepEqual(searchGuide(index, 'barcelona', NOW).map((r) => r.title), [
    '(EN DIRECTO) Villarreal CF - RCD Espanyol de Barcelona - LALIGA EA SPORTS',
    'Barcelona TV: magazine',
  ]);
});

test('results carry every version of the channel', () => {
  const [hit] = searchGuide(index, 'villarreal', NOW);
  assert.deepEqual(hit.streams.map((s) => s.stream_id), [1, 2]);
  assert.equal(hit.channel, 'ES: M+ LaLiga FHD');
});

test('sportsStreams picks sports categories plus extra ids; channelMap groups versions best first', () => {
  const cats = [
    { category_id: '1', category_name: 'ES | DEPORTES' },
    { category_id: '2', category_name: 'ES | NOTICIAS' },
    { category_id: '3', category_name: 'DAZN' },
    { category_id: '4', category_name: 'M+ LALIGA' },
  ];
  const streams = [
    { stream_id: 10, name: 'ES: M+ LaLiga HD', category_id: '4', epg_channel_id: 'MLaLiga.es' },
    { stream_id: 11, name: 'ES: M+ LaLiga FHD', category_id: '4', epg_channel_id: 'MLaLiga.es' },
    { stream_id: 12, name: 'Telediario', category_id: '2', epg_channel_id: 'tve.es' },
    { stream_id: 13, name: 'Fav news', category_id: '2', epg_channel_id: '' },
    { stream_id: 14, name: 'DAZN 1', category_id: '3', epg_channel_id: null },
  ];
  const subset = sportsStreams(cats, streams, ['13']);
  assert.equal(subset.categories, 3);
  assert.deepEqual(subset.streams.map((s) => s.stream_id), [10, 11, 13, 14]);
  const map = channelMap(subset.streams);
  assert.deepEqual(Object.keys(map), ['mlaliga.es']);
  assert.deepEqual(map['mlaliga.es'].streams.map((s) => s.stream_id), [11, 10]);
});
