// Fixtures from ESPN's public scoreboard API (no key). Everything ESPN-specific stays in
// this file, so it can be swapped for another source (e.g. football-data.org) later.
//   GET https://site.api.espn.com/apis/site/v2/sports/{sport}/{league}/scoreboard?dates=YYYYMMDD
// One day per request: a date range returns nothing.

const ESPN = 'https://site.api.espn.com/apis/site/v2/sports';
const DAYS_AHEAD = 7;
const TENNIS_DAYS = 2;
const CONCURRENCY = 6;
const GAP_MS = 50;
const TIMEOUT_MS = 15000;

// group: the Sport Center filter chip. national: only matches where `national` plays.
const LEAGUES = [
  { id: 'esp.1', path: 'soccer/esp.1', name: 'LaLiga', group: 'football' },
  { id: 'eng.1', path: 'soccer/eng.1', name: 'Premier League', group: 'football' },
  { id: 'ita.1', path: 'soccer/ita.1', name: 'Serie A', group: 'football' },
  { id: 'ger.1', path: 'soccer/ger.1', name: 'Bundesliga', group: 'football' },
  { id: 'fra.1', path: 'soccer/fra.1', name: 'Ligue 1', group: 'football' },
  { id: 'uefa.champions', path: 'soccer/uefa.champions', name: 'Champions League', group: 'football' },
  { id: 'uefa.europa', path: 'soccer/uefa.europa', name: 'Europa League', group: 'football' },
  { id: 'uefa.europa.conf', path: 'soccer/uefa.europa.conf', name: 'Conference League', group: 'football' },
  { id: 'uefa.super_cup', path: 'soccer/uefa.super_cup', name: 'UEFA Super Cup', group: 'football' },
  { id: 'esp.copa_del_rey', path: 'soccer/esp.copa_del_rey', name: 'Copa del Rey', group: 'football' },
  { id: 'spain', name: 'Spain (national team)', group: 'football', national: 'Spain', paths: ['soccer/uefa.nations', 'soccer/fifa.worldq.uefa', 'soccer/fifa.world', 'soccer/fifa.friendly', 'soccer/uefa.euro'] },
  { id: 'atp', path: 'tennis/atp', name: 'ATP', group: 'tennis', tennis: true },
  { id: 'wta', path: 'tennis/wta', name: 'WTA', group: 'tennis', tennis: true },
  { id: 'f1', path: 'racing/f1', name: 'Formula 1', group: 'f1', racing: true },
  { id: 'motogp', name: 'MotoGP', group: 'motogp', motogp: true }, // lib/motogp.js
  { id: 'nfl', path: 'football/nfl', name: 'NFL', group: 'nfl' },
  { id: 'nba', path: 'basketball/nba', name: 'NBA', group: 'nba' },
];
const LEAGUE_BY_ID = Object.fromEntries(LEAGUES.map((l) => [l.id, l]));

// ESPN competition names for the national-team paths, shown on the card.
const NATIONAL_NAMES = {
  'soccer/uefa.nations': 'Nations League',
  'soccer/fifa.worldq.uefa': 'World Cup qualifying',
  'soccer/fifa.world': 'World Cup',
  'soccer/fifa.friendly': 'Friendly',
  'soccer/uefa.euro': 'European Championship',
};

// F1 sessions worth a card (ESPN competitions[].type.abbreviation).
const F1_SESSIONS = { Qual: 'Qualifying', Race: 'Race', Sprint: 'Sprint', SS: 'Sprint qualifying', SQ: 'Sprint qualifying' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- Fetch queue + cache ----------

const cache = new Map(); // url -> { data, at, ttl }
const inflight = new Map();
let active = 0;
const waiting = [];

async function slot(fn) {
  if (active >= CONCURRENCY) await new Promise((r) => waiting.push(r));
  active += 1;
  try {
    return await fn();
  } finally {
    await sleep(GAP_MS);
    active -= 1;
    if (waiting.length) waiting.shift()();
  }
}

// GET JSON with a cache; ttl(data) decides how long this answer stays fresh. A stale
// answer is returned right away while a fresh one is fetched in the background.
function cachedJson(url, ttl) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < hit.ttl) return Promise.resolve(hit.data);
  if (!inflight.has(url)) {
    const p = slot(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const r = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const data = await r.json();
        cache.delete(url);
        cache.set(url, { data, at: Date.now(), ttl: ttl(data) });
        if (cache.size > 2000) cache.delete(cache.keys().next().value);
        return data;
      } finally {
        clearTimeout(timer);
      }
    }).finally(() => inflight.delete(url));
    inflight.set(url, p);
  }
  const p = inflight.get(url);
  if (hit) {
    p.catch(() => {});
    return Promise.resolve(hit.data);
  }
  return p;
}

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10).replace(/-/g, '');

function scoreboardTtl(day, today) {
  return (data) => {
    if (day < today) return 6 * 3600e3;
    const live = JSON.stringify(data.events || []).includes('"state":"in"');
    return live ? 60e3 : 30 * 60e3;
  };
}

const scoreboard = (path, day, today) => cachedJson(`${ESPN}/${path}/scoreboard?dates=${day}`, scoreboardTtl(day, today));

// ---------- ESPN -> Event ----------

const team = (c) => ({
  name: c.team.displayName,
  short: c.team.shortDisplayName || c.team.displayName,
  abbr: c.team.abbreviation || '',
  logo: c.team.logo || '',
  score: c.score ?? '',
});

const statusOf = (s) => ({
  state: (s && s.type && s.type.state) || 'pre',
  clock: (s && s.displayClock) || '',
  detail: (s && s.type && (s.type.shortDetail || s.type.detail)) || '',
});

function teamEvent(e, league, leagueName) {
  const comp = (e.competitions || [])[0];
  if (!comp) return null;
  const home = (comp.competitors || []).find((c) => c.homeAway === 'home');
  const away = (comp.competitors || []).find((c) => c.homeAway === 'away');
  if (!home || !away || !home.team || !away.team) return null;
  const note = (comp.notes || []).map((n) => n.headline).filter(Boolean)[0] || '';
  return {
    id: `espn:${e.id}`,
    league: league.id,
    leagueName: leagueName || league.name,
    group: league.group,
    kind: 'teams',
    start: Date.parse(comp.date || e.date),
    ...statusOf(comp.status || e.status),
    round: note,
    venue: (comp.venue && comp.venue.fullName) || '',
    home: team(home),
    away: team(away),
  };
}

// Tennis scoreboards are per tournament; the matches are in groupings[].competitions[].
function tennisEvents(e, league, now) {
  const out = [];
  (e.groupings || []).forEach((g) => {
    const label = (g.grouping && g.grouping.displayName) || '';
    if (!/singles/i.test(label)) return;
    (g.competitions || []).forEach((c) => {
      const players = (c.competitors || []).filter((p) => p.athlete && p.athlete.displayName && !/^tbd$/i.test(p.athlete.displayName));
      if (players.length !== 2) return;
      const start = Date.parse(c.date || c.startDate);
      const st = statusOf(c.status);
      if (st.state !== 'in' && (start > now + TENNIS_DAYS * 24 * 3600e3 || start < now - 12 * 3600e3)) return;
      const player = (p) => ({
        name: p.athlete.displayName,
        short: p.athlete.shortName || p.athlete.displayName,
        country: (p.athlete.flag && p.athlete.flag.alt) || '',
        logo: (p.athlete.flag && p.athlete.flag.href) || '',
        score: (p.linescores || []).map((l) => l.value).join(' '),
      });
      const [a, b] = [...players].sort((x, y) => (x.order || 0) - (y.order || 0));
      out.push({
        id: `espn:${league.id}:${c.id}`,
        league: league.id,
        leagueName: league.name,
        group: league.group,
        kind: 'players',
        start,
        // ESPN puts unscheduled matches at a placeholder time; flag it so the UI says "time TBC".
        timeKnown: c.timeValid !== false,
        ...st,
        tournament: e.name || '',
        round: (c.round && c.round.displayName) || '',
        venue: (c.venue && c.venue.court) || '',
        home: player(a),
        away: player(b),
      });
    });
  });
  return out;
}

// One F1 Grand Prix event lists its sessions in competitions[].
function f1Events(e, league) {
  return (e.competitions || []).map((c) => {
    const abbr = c.type && c.type.abbreviation;
    if (!F1_SESSIONS[abbr]) return null;
    return {
      id: `espn:f1:${c.id}`,
      league: league.id,
      leagueName: league.name,
      group: league.group,
      kind: 'race',
      start: Date.parse(c.date),
      ...statusOf(c.status),
      title: e.name || e.shortName || 'Grand Prix',
      session: F1_SESSIONS[abbr],
      sessionType: abbr === 'Race' ? 'race' : abbr === 'Qual' ? 'qualifying' : 'sprint',
      venue: (e.circuit && e.circuit.fullName) || '',
    };
  }).filter(Boolean);
}

const involves = (ev, name) => [ev.home, ev.away].some((t) => t && t.name.toLowerCase() === name.toLowerCase());

async function leagueEvents(league, days, today, now) {
  if (league.tennis) {
    // Any date returns the whole tournament, so one request covers the next days.
    const data = await scoreboard(league.path, today, today);
    return (data.events || []).flatMap((e) => tennisEvents(e, league, now));
  }
  const paths = league.paths || [league.path];
  const out = [];
  for (const p of paths) {
    const boards = await Promise.all(days.map((d) => scoreboard(p, d, today).catch(() => ({ events: [] }))));
    boards.forEach((data) => (data.events || []).forEach((e) => {
      if (league.racing) out.push(...f1Events(e, league));
      else {
        const ev = teamEvent(e, league, league.national ? NATIONAL_NAMES[p] : null);
        if (ev && (!league.national || involves(ev, league.national))) out.push(ev);
      }
    }));
  }
  return out;
}

// Events for the given league ids over [yesterday, today + DAYS_AHEAD), deduplicated.
// Leagues that fail are left out and reported in `errors`.
async function fetchEvents(leagueIds, now = Date.now()) {
  const today = ymd(now);
  const days = Array.from({ length: DAYS_AHEAD + 1 }, (_, i) => ymd(now + (i - 1) * 24 * 3600e3));
  const leagues = leagueIds.map((id) => LEAGUE_BY_ID[id]).filter((l) => l && !l.motogp);
  const errors = [];
  const lists = await Promise.all(leagues.map((l) => leagueEvents(l, days, today, now).catch((e) => {
    errors.push(`${l.name}: ${e.message}`);
    return [];
  })));
  const seen = new Map();
  lists.flat().forEach((ev) => { if (Number.isFinite(ev.start)) seen.set(ev.id, ev); });
  return { events: [...seen.values()], errors };
}

const leagueCatalog = () => LEAGUES.map(({ id, name, group }) => ({ id, name, group }));

module.exports = { LEAGUES, LEAGUE_BY_ID, fetchEvents, leagueCatalog, cachedJson, teamEvent, tennisEvents, f1Events };
