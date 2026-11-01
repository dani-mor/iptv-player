const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeXml, parseXmltvTime, parseXmltv, createXmltvParser } = require('../lib/xmltv');

test('decodeXml handles entities, numeric references and CDATA', () => {
  assert.equal(decodeXml('Barça &amp; Madrid &lt;3 &quot;x&quot; &apos;y&apos;'), 'Barça & Madrid <3 "x" \'y\'');
  assert.equal(decodeXml('Resúmenes &#183; Jornada&#x20;12'), 'Resúmenes · Jornada 12');
  assert.equal(decodeXml('<![CDATA[Tom &amp; Jerry <b>]]>'), 'Tom &amp; Jerry <b>');
  assert.equal(decodeXml('&unknown;'), '&unknown;');
});

test('parseXmltvTime uses the offset, and UTC when there is none', () => {
  assert.equal(parseXmltvTime('20261101200000 +0000'), Date.UTC(2026, 10, 1, 20, 0, 0));
  assert.equal(parseXmltvTime('20261101210000 +0100'), Date.UTC(2026, 10, 1, 20, 0, 0));
  assert.equal(parseXmltvTime('20261101150000 -0500'), Date.UTC(2026, 10, 1, 20, 0, 0));
  assert.equal(parseXmltvTime('20261101200000'), Date.UTC(2026, 10, 1, 20, 0, 0));
  assert.equal(parseXmltvTime('202611012000'), Date.UTC(2026, 10, 1, 20, 0, 0));
  assert.ok(Number.isNaN(parseXmltvTime('soon')));
});

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<tv generator-info-name="x">
  <channel id="MLaLiga.es"><display-name>M+ LaLiga</display-name></channel>
  <channel id="Other.es"><display-name>Other</display-name></channel>
  <programme start="20261101231500 +0100" stop="20261102011500 +0100" channel="MLaLiga.es">
    <title lang="es">(EN DIRECTO) Villarreal CF - RCD Espanyol de Barcelona - LALIGA EA SPORTS</title>
    <desc lang="es">Partido &amp; más</desc>
  </programme>
  <programme start="20261101100000 +0000" stop="20261101110000 +0000" channel="Other.es"><title>News</title></programme>
  <programme start="20261101120000 +0000" stop="20261101130000 +0000" channel="MLaLiga.es" />
  <programme start="20261101130000 +0000" stop="20261101140000 +0000" channel="MLaLiga.es"><title>Next</title></programme>
</tv>`;

test('parseXmltv keeps the wanted channels and decodes programmes', () => {
  const out = parseXmltv(SAMPLE, { keep: (id) => id === 'MLaLiga.es' });
  assert.equal(out.totalChannels, 2);
  assert.equal(out.totalProgrammes, 4);
  assert.deepEqual(Object.keys(out.channels), ['MLaLiga.es']);
  assert.equal(out.programmes.length, 2); // the self-closing one has no title
});

test('self-closing programmes do not swallow the next one; times span midnight', () => {
  const out = parseXmltv(SAMPLE, { keep: (id) => id === 'MLaLiga.es' });
  const [next, match] = [...out.programmes].sort((a, b) => a.start - b.start);
  assert.equal(match.title, '(EN DIRECTO) Villarreal CF - RCD Espanyol de Barcelona - LALIGA EA SPORTS');
  assert.equal(match.desc, 'Partido & más');
  assert.equal(match.start, Date.UTC(2026, 10, 1, 22, 15));
  assert.equal(match.end, Date.UTC(2026, 10, 2, 0, 15));
  assert.equal(next.title, 'Next');
  assert.equal(next.start, Date.UTC(2026, 10, 1, 13));
});

test('the time window drops programmes outside it', () => {
  const out = parseXmltv(SAMPLE, { from: Date.UTC(2026, 10, 1, 13, 30), to: Date.UTC(2026, 10, 3) });
  assert.deepEqual(out.programmes.map((p) => p.title).sort(), ['(EN DIRECTO) Villarreal CF - RCD Espanyol de Barcelona - LALIGA EA SPORTS', 'Next']);
});

test('the chunked parser gives the same result whatever the chunk size', () => {
  const whole = parseXmltv(SAMPLE);
  for (const size of [1, 7, 64, 1000]) {
    const p = createXmltvParser();
    for (let i = 0; i < SAMPLE.length; i += size) p.push(SAMPLE.slice(i, i + size));
    const out = p.end();
    assert.deepEqual(out.programmes, whole.programmes);
    assert.equal(out.totalChannels, whole.totalChannels);
  }
});
