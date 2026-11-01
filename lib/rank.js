// Ranks Sport Center events: which match is the main one, and the order of the rest.
// A transparent score; the weights are meant to be tuned after some real use.

const { normTitle } = require('./titles');

const W = {
  yourTeam: 50,
  spanishAthlete: 30,
  live: 40,
  soon: 25, // fades linearly to 0 over SOON_MS before the start
  night: -15, // starts 00:00-07:00 local time (most NBA / NFL)
  topMatch: 20,
  onChannels: 15,
};
const SOON_MS = 3 * 3600e3;
const HIDE_AFTER_END_MS = 30 * 60e3;
const MAX_EVENTS = 40;
const PER_LEAGUE_CAP = { atp: 6, wta: 4, nba: 6, nfl: 6 };

const COMPETITION = {
  'uefa.champions': 30,
  'esp.1': 25,
  spain: 25,
  'eng.1': 15, 'ita.1': 15, 'ger.1': 15, 'fra.1': 15, 'uefa.europa': 15, 'uefa.super_cup': 15,
  'esp.copa_del_rey': 12, 'uefa.europa.conf': 12,
  nba: 10, nfl: 10, atp: 10, wta: 10,
};
// F1 / MotoGP: by session.
const RACING = { race: 20, sprint: 14, qualifying: 12 };

// Typical length, to tell when a finished event has been over for a while.
const DURATION_MIN = { football: 115, tennis: 150, nba: 150, nfl: 200, f1: 120, motogp: 50 };
const RACING_DURATION_MIN = { qualifying: 60, sprint: 45 };

// Big clubs (normalised ESPN names) per league; two of them = "Top match".
const BIG_CLUBS = {
  'esp.1': ['real madrid', 'barcelona', 'atletico madrid'],
  'eng.1': ['manchester city', 'arsenal', 'liverpool', 'chelsea', 'manchester united', 'tottenham hotspur'],
  'ita.1': ['internazionale', 'ac milan', 'juventus', 'napoli', 'as roma'],
  'ger.1': ['bayern munich', 'borussia dortmund', 'bayer leverkusen'],
  'fra.1': ['paris saint germain', 'marseille', 'as monaco'],
};
const EUROPEAN_BIG = new Set([...Object.values(BIG_CLUBS).flat(), 'benfica', 'fc porto', 'sporting cp']);
const DERBIES = [
  ['real betis', 'sevilla'], ['barcelona', 'espanyol'], ['athletic club', 'real sociedad'],
  ['celta vigo', 'deportivo'], ['valencia', 'levante'], ['ac milan', 'internazionale'],
  ['as roma', 'lazio'], ['juventus', 'torino'], ['arsenal', 'tottenham hotspur'],
  ['liverpool', 'everton'], ['manchester city', 'manchester united'], ['borussia dortmund', 'schalke 04'],
];

const isEuropean = (league) => league.startsWith('uefa.');

function isTopMatch(ev) {
  if (ev.kind !== 'teams') return false;
  const a = normTitle(ev.home.name);
  const b = normTitle(ev.away.name);
  if (DERBIES.some(([x, y]) => (a === x && b === y) || (a === y && b === x))) return true;
  const big = isEuropean(ev.league) ? EUROPEAN_BIG : new Set(BIG_CLUBS[ev.league] || []);
  return big.has(a) && big.has(b);
}

const expectedEnd = (ev) => ev.start + 60e3 * (ev.kind === 'race'
  ? (ev.sessionType === 'race' ? DURATION_MIN[ev.group] : RACING_DURATION_MIN[ev.sessionType] || 60)
  : DURATION_MIN[ev.group] || 120);

function playsFor(ev, teams) {
  if (ev.kind === 'race') return false;
  const wanted = new Set(teams.map(normTitle).filter(Boolean));
  return [ev.home, ev.away].some((t) => t && (wanted.has(normTitle(t.name)) || wanted.has(normTitle(t.short))));
}

// opts: { now, teams: ["Real Madrid", "Spain"], spanishAthletes, localHour(ms) }
function scoreEvent(ev, { now = Date.now(), teams = [], spanishAthletes = false, localHour = (ms) => new Date(ms).getHours() } = {}) {
  let rank = 0;
  const tags = [];
  if (playsFor(ev, teams)) { rank += W.yourTeam; tags.push('your-team'); }
  if (spanishAthletes) {
    // A Spaniard is on every F1 / MotoGP grid, so racing only gets it for the race itself.
    const spanish = ev.kind === 'players'
      ? [ev.home, ev.away].some((p) => p.country === 'Spain')
      : ev.kind === 'race' && ev.sessionType === 'race';
    if (spanish) { rank += W.spanishAthlete; tags.push('spanish'); }
  }
  if (ev.state === 'in') rank += W.live;
  else if (ev.state === 'pre' && ev.start >= now && ev.start - now <= SOON_MS) {
    rank += W.soon * (1 - (ev.start - now) / SOON_MS);
  }
  rank += ev.kind === 'race' ? RACING[ev.sessionType] || 10 : COMPETITION[ev.league] || 10;
  const h = localHour(ev.start);
  if (h >= 0 && h < 7) rank += W.night;
  if (isTopMatch(ev)) { rank += W.topMatch; tags.push('top-match'); }
  if ((ev.where || []).some((w) => w.confidence === 'guide')) rank += W.onChannels;
  return { rank: Math.round(rank * 10) / 10, tags };
}

const isOver = (ev, now) => ev.state === 'post' && now > expectedEnd(ev) + HIDE_AFTER_END_MS;

// Ranked events (finished ones dropped, a few per busy league) and the main match:
// the best one that is live or still to come.
function rankEvents(events, opts = {}) {
  const now = opts.now || Date.now();
  const scored = events
    .filter((ev) => !isOver(ev, now))
    .map((ev) => ({ ...ev, ...scoreEvent(ev, { ...opts, now }) }))
    .sort((a, b) => b.rank - a.rank || a.start - b.start);
  const perLeague = {};
  const kept = scored.filter((ev) => {
    const cap = PER_LEAGUE_CAP[ev.league];
    perLeague[ev.league] = (perLeague[ev.league] || 0) + 1;
    return !cap || perLeague[ev.league] <= cap || ev.tags.length > 0;
  }).slice(0, MAX_EVENTS);
  const featured = kept.find((ev) => ev.state !== 'post') || null;
  return { featured, events: kept };
}

module.exports = { W, scoreEvent, rankEvents, isTopMatch, expectedEnd };
