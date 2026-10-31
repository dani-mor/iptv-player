import test from 'node:test';
import assert from 'node:assert/strict';
import { fold, parseChannelName, versionKey, versionLabels, matchesQuery } from '../public/js/names.js';

test('parseChannelName strips country prefixes and pulls out the quality', () => {
  assert.deepEqual(parseChannelName('|ES| DAZN LALIGA FHD'), { title: 'DAZN LALIGA', quality: 'FHD', tags: ['FHD'] });
  assert.deepEqual(parseChannelName('ES: M+ LaLiga TV HD'), { title: 'M+ LaLiga TV', quality: 'HD', tags: ['HD'] });
  assert.deepEqual(parseChannelName('[ES] Movistar Plus+ 4K HEVC'), { title: 'Movistar Plus+', quality: '4K', tags: ['4K', 'HEVC'] });
  assert.deepEqual(parseChannelName('DAZN 1 ᶠᴴᴰ'), { title: 'DAZN 1', quality: 'FHD', tags: ['FHD'] });
  assert.deepEqual(parseChannelName('ESP - La 1 SD'), { title: 'La 1', quality: 'SD', tags: ['SD'] });
  assert.equal(parseChannelName('HDTV Plus').title, 'HDTV Plus');
  assert.equal(parseChannelName('BBC: News').title, 'BBC: News');
  assert.equal(parseChannelName('Cuatro').quality, '');
});

test('a name that is only tags keeps its original text', () => {
  assert.equal(parseChannelName('|ES| HD').title, '|ES| HD');
});

test('versionKey groups qualities of one channel, not different channels', () => {
  assert.equal(versionKey('|ES| DAZN LALIGA FHD'), versionKey('|ES| DAZN LALIGA HD'));
  assert.equal(versionKey('|ES| DAZN LALIGA FHD'), versionKey('ES: DAZN LaLiga SD'));
  assert.equal(versionKey('|ES| DAZN LALIGA FHD'), versionKey('|ES| DAZN LALIGA BACKUP'));
  assert.notEqual(versionKey('|ES| DAZN LALIGA FHD'), versionKey('|ES| DAZN LALIGA 2 FHD'));
  assert.notEqual(versionKey('M+ LaLiga'), versionKey('LaLiga'));
});

test('versionLabels numbers duplicates', () => {
  const labels = versionLabels([{ name: 'X FHD' }, { name: 'X HD' }, { name: 'X HD' }, { name: 'X' }]);
  assert.deepEqual(labels, ['FHD', 'HD', 'HD 2', 'Standard']);
});

test('search ignores accents and case', () => {
  assert.equal(fold('Película ESPAÑA'), 'pelicula espana');
  assert.ok(matchesQuery({ name: 'La Película' }, fold('pelicula')));
  assert.ok(!matchesQuery({ name: 'Serie' }, fold('pelicula')));
});
