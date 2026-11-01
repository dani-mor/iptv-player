const test = require('node:test');
const assert = require('node:assert/strict');
const { teamVariants, matchEvents, guessChannels, NOT_LIVE } = require('../lib/fixture-match');
const { scoreEvent, rankEvents, isTopMatch } = require('../lib/rank');
const { teamEvent, tennisEvents, f1Events } = require('../lib/sports');

const H = 3600e3;
const KICKOFF = Date.UTC(2026, 10, 1, 20, 0);
const T = (name, short) => ({ name, short: short || name });
const fixture = (id, league, home, away, extra = {}) => ({ id, league, group: 'football', kind: 'teams', start: KICKOFF, state: 'pre', home, away, ...extra });
const streams = (id, name) => [{ stream_id: id, name }];
const prog = (channel, title, start = KICKOFF - 5 * 60e3, end = KICKOFF + 2 * H) => ({ channel, title, start, end, streams: streams(channel.length, `${channel} FHD`) });

test('team variants: affixes dropped, aliases added, ambiguous short names left out', () => {
  assert.deepEqual(teamVariants(T('Atlético Madrid', 'Atlético')), ['atletico madrid', 'atletico de madrid', 'atleti']);
  assert.ok(teamVariants(T('Internazionale', 'Inter Milan')).includes('inter de milan'));
  assert.ok(teamVariants(T('Bayern Munich', 'Bayern')).includes('bayern munchen'));
  assert.deepEqual(teamVariants(T('Racing Santander', 'Racing')), ['racing santander', 'racing de santander', 'real racing']);
  assert.ok(teamVariants({ name: 'Carlos Alcaraz' }, { kind: 'players' }).includes('alcaraz'));
});

test('both teams in a real guide title is a sure match, accents and affixes aside', () => {
  const ev = fixture('e1', 'esp.1', T('Villarreal'), T('Espanyol'));
  const m = matchEvents([ev], [prog('mlaliga', '(EN DIRECTO) Villarreal CF - RCD Espanyol de Barcelona - LALIGA EA SPORTS')]);
  assert.equal(m.get('e1')[0].confidence, 'guide');
  assert.equal(m.get('e1')[0].strength, 3);
});

test('"Espanyol de Barcelona" is not Barcelona', () => {
  const ev = fixture('e2', 'esp.1', T('Barcelona'), T('Sevilla'));
  const m = matchEvents([ev], [prog('mlaliga', '(EN DIRECTO) Villarreal CF - RCD Espanyol de Barcelona - LALIGA EA SPORTS')]);
  assert.equal(m.has('e2'), false);
});

test('one team plus the competition is a weaker match, unless another fixture owns the programme', () => {
  const madrid = fixture('rm', 'esp.1', T('Real Madrid'), T('Racing Santander', 'Racing'));
  const one = matchEvents([madrid], [prog('dazn', 'LALIGA EA SPORTS: Real Madrid - Racing')]);
  assert.equal(one.get('rm')[0].strength, 2);
  // Barça plays at the same time; the title names Barça and its opponent, so it's theirs.
  const barca = fixture('fcb', 'esp.1', T('Barcelona'), T('Getafe'));
  const both = matchEvents([madrid, barca], [prog('dazn', 'LALIGA EA SPORTS: Barcelona - Getafe (Real Madrid espera)')]);
  assert.equal(both.has('rm'), false);
  assert.equal(both.get('fcb')[0].strength, 3);
});

test('a likely match on a local channel is listed before a sure one abroad', () => {
  const ev = fixture('rm', 'esp.1', T('Racing Santander', 'Racing'), T('Real Madrid'));
  const local = { ...prog('dazn-es', 'DIRECTO Jornada 11: Racing - Real Madrid T26/27 · LALIGA EA SPORTS'), streams: [{ stream_id: 1, name: '|ES| DAZN LALIGA FHD' }] };
  const abroad = { ...prog('dazn-fr', 'Racing Santander / Real Madrid'), streams: [{ stream_id: 2, name: 'FR: DAZN 1 FHD' }] };
  const where = matchEvents([ev], [abroad, local]).get('rm');
  assert.deepEqual(where.map((w) => [w.channel, w.strength]), [['|ES| DAZN LALIGA FHD', 2], ['FR: DAZN 1 FHD', 3]]);
});

test('programmes far from kick-off, highlights and previews are ignored', () => {
  const ev = fixture('e3', 'esp.1', T('Celta Vigo', 'Celta'), T('Getafe'));
  const far = prog('m1', 'Celta - Getafe', KICKOFF + 3 * H, KICKOFF + 5 * H);
  const recap = prog('m2', 'Resúmenes LALIGA · Jornada 12: Celta - Getafe');
  const preview = prog('m3', 'Previa: Celta - Getafe');
  assert.equal(matchEvents([ev], [far, recap, preview]).has('e3'), false);
  assert.ok(NOT_LIVE.test('Resúmenes LALIGA HyperMotion T26/27 · Jornada 12: Celta Fortuna - Córdoba'));
  assert.ok(!NOT_LIVE.test('(EN DIRECTO) Villarreal CF - RCD Espanyol de Barcelona - LALIGA EA SPORTS'));
});

test('tennis matches on surnames; F1 / MotoGP on the Grand Prix place and session', () => {
  const tennis = { id: 't', league: 'atp', kind: 'players', start: KICKOFF, home: { name: 'Alex de Minaur' }, away: { name: 'Carlos Alcaraz' } };
  assert.ok(matchEvents([tennis], [prog('tenis', 'ATP 500 Viena. Final: De Miñaur - Alcaraz')]).has('t'));
  const race = { id: 'r', league: 'f1', kind: 'race', start: KICKOFF, title: 'MSC Cruises São Paulo Grand Prix', sessionType: 'race' };
  assert.ok(matchEvents([race], [prog('f1', 'F1: GP de Brasil - Carrera')]).has('r'));
  assert.equal(matchEvents([race], [prog('f1', 'F1: GP de Brasil - Clasificación')]).has('r'), false);
  const moto = { id: 'q', league: 'motogp', kind: 'race', start: KICKOFF, title: 'Qatar Airways Grand Prix of Qatar', shortTitle: 'GRAND PRIX OF QATAR', sessionType: 'sprint' };
  assert.ok(matchEvents([moto], [prog('dazn', '(EN DIRECTO) MotoGP GP de Catar: Sprint')]).has('q'));
});

test('best guess groups versions and is labelled as a guess', () => {
  const ev = fixture('g', 'uefa.champions', T('Villarreal'), T('Paris Saint-Germain', 'PSG'));
  const list = [
    { stream_id: 1, name: 'ES: M+ Liga de Campeones 2 HD' },
    { stream_id: 2, name: 'ES: M+ Liga de Campeones FHD' },
    { stream_id: 3, name: 'ES: M+ Liga de Campeones 2 FHD' },
    { stream_id: 4, name: 'ES: Cocina' },
  ];
  const guess = guessChannels(ev, list);
  assert.deepEqual(guess.map((g) => g.streams.map((s) => s.stream_id)), [[2], [3, 1]]);
  assert.ok(guess.every((g) => g.confidence === 'guess'));
});

// ---------- Ranking ----------

const opts = { now: KICKOFF - H, teams: ['Real Madrid', 'Spain'], spanishAthletes: true, localHour: (ms) => new Date(ms).getUTCHours() + 1 };

test('your team, live and top matches rank first; night games lose points', () => {
  const madrid = fixture('rm', 'esp.1', T('Real Madrid'), T('Getafe'), { start: KICKOFF + 2 * 24 * H });
  const clasico = fixture('cl', 'esp.1', T('Barcelona'), T('Real Madrid'));
  const live = fixture('lv', 'eng.1', T('Fulham'), T('Brentford'), { state: 'in', start: KICKOFF - 2 * H });
  const nba = { ...fixture('nba', 'nba', T('Boston Celtics'), T('Miami Heat')), group: 'nba', start: KICKOFF + 6 * H };
  assert.ok(scoreEvent(clasico, opts).tags.includes('top-match'));
  assert.ok(scoreEvent(madrid, opts).tags.includes('your-team'));
  assert.ok(scoreEvent(live, opts).rank > scoreEvent(fixture('x', 'eng.1', T('Fulham'), T('Brentford')), { ...opts, now: KICKOFF - 5 * H }).rank);
  assert.ok(scoreEvent(nba, opts).rank < 0);
  const { featured, events } = rankEvents([nba, live, madrid, clasico], opts);
  assert.equal(featured.id, 'cl');
  assert.deepEqual(events.map((e) => e.id), ['cl', 'rm', 'lv', 'nba']);
});

test('being on the user\'s channels counts; finished events disappear 30 min after the end', () => {
  const a = fixture('a', 'ita.1', T('Lecce'), T('Como'));
  const b = { ...a, id: 'b', where: [{ confidence: 'guide' }] };
  assert.equal(Math.round(scoreEvent(b, opts).rank - scoreEvent(a, opts).rank), 15);
  const over = { ...a, id: 'over', state: 'post', start: KICKOFF - 4 * H };
  const justOver = { ...a, id: 'just', state: 'post', start: KICKOFF - 2 * H };
  assert.deepEqual(rankEvents([over, justOver], opts).events.map((e) => e.id), ['just']);
  assert.equal(rankEvents([over, justOver], opts).featured, null);
});

test('Spanish players get the boost; derbies are top matches', () => {
  const t = { id: 't', league: 'atp', group: 'tennis', kind: 'players', start: KICKOFF, state: 'pre', home: { name: 'A', country: 'Spain' }, away: { name: 'B', country: 'Italy' } };
  assert.ok(scoreEvent(t, opts).tags.includes('spanish'));
  assert.ok(!scoreEvent(t, { ...opts, spanishAthletes: false }).tags.includes('spanish'));
  assert.ok(isTopMatch(fixture('d', 'esp.1', T('Sevilla'), T('Real Betis'))));
  assert.ok(!isTopMatch(fixture('d', 'esp.1', T('Sevilla'), T('Getafe'))));
});

// ---------- ESPN shapes ----------

test('ESPN scoreboard events become Events', () => {
  const league = { id: 'esp.1', name: 'LaLiga', group: 'football' };
  const ev = teamEvent({
    id: '1', date: '2026-11-01T20:00Z',
    status: { displayClock: "78'", type: { state: 'in', shortDetail: "78'" } },
    competitions: [{ date: '2026-11-01T20:00Z', competitors: [
      { homeAway: 'home', score: '1', team: { displayName: 'Real Sociedad', shortDisplayName: 'Real Sociedad', abbreviation: 'RSO', logo: 'x' } },
      { homeAway: 'away', score: '2', team: { displayName: 'Athletic Club', shortDisplayName: 'Athletic', abbreviation: 'ATH', logo: 'y' } },
    ] }],
  }, league);
  assert.equal(ev.start, KICKOFF);
  assert.equal(ev.state, 'in');
  assert.equal(ev.home.name, 'Real Sociedad');
  assert.equal(ev.away.score, '2');

  const tennis = tennisEvents({ name: 'Rolex Paris Masters', groupings: [
    { grouping: { displayName: "Men's Doubles" }, competitions: [] },
    { grouping: { displayName: "Men's Singles" }, competitions: [
      { id: 9, date: '2026-11-01T20:00Z', status: { type: { state: 'pre' } }, round: { displayName: 'Round 1' }, competitors: [
        { order: 2, athlete: { displayName: 'Carlos Alcaraz', flag: { alt: 'Spain' } } },
        { order: 1, athlete: { displayName: 'Jannik Sinner', flag: { alt: 'Italy' } } },
      ] },
      { id: 10, date: '2026-11-09T20:00Z', status: { type: { state: 'pre' } }, competitors: [{ athlete: { displayName: 'A' } }, { athlete: { displayName: 'B' } }] },
    ] },
  ] }, { id: 'atp', name: 'ATP', group: 'tennis' }, KICKOFF);
  assert.equal(tennis.length, 1);
  assert.equal(tennis[0].home.name, 'Jannik Sinner');
  assert.equal(tennis[0].away.country, 'Spain');

  const f1 = f1Events({ name: 'Mexico City Grand Prix', competitions: [
    { id: 1, date: '2026-10-30T18:30Z', type: { abbreviation: 'FP1' }, status: { type: { state: 'post' } } },
    { id: 2, date: '2026-10-31T21:00Z', type: { abbreviation: 'Qual' }, status: { type: { state: 'post' } } },
    { id: 3, date: '2026-11-01T20:00Z', type: { abbreviation: 'Race' }, status: { type: { state: 'pre' } } },
  ] }, { id: 'f1', name: 'Formula 1', group: 'f1' });
  assert.deepEqual(f1.map((e) => e.session), ['Qualifying', 'Race']);
});
