// Links a fixture (lib/sports.js Event) to the guide programmes that show it, or, when
// the guide has nothing, to a best guess from channel names. Pure, so it's unit tested.

const { normTitle } = require('./titles');
const { versionKey, qualityRank } = require('../public/js/names.js');

// A programme counts if it starts within this of kick-off, or is on air at kick-off.
const WINDOW_MS = 45 * 60e3;
const LONGEST_PROGRAMME_MS = 12 * 3600e3;
const MAX_WHERE = 4;
// Channels for this country (or with no country tag) are listed before foreign copies.
const HOME_COUNTRY = 'ES';

// Club prefixes / suffixes that guides and ESPN use inconsistently.
const AFFIXES = new Set(['fc', 'cf', 'cd', 'rcd', 'sd', 'ud', 'rc', 'sad', 'club', 'afc', 'ssc', 'as', 'ac', 'sc', 'ca', 'sl', 'cp', 'fk', 'sk', 'nk', 'tsg', 'vfb', 'vfl', 'sv', 'rb', 'bc', '1']);
const DROP_PHRASES = [' de futbol', ' football club'];
// Names too common to identify a team on their own; the alias table has longer forms.
const AMBIGUOUS = new Set(['deportivo', 'racing', 'sporting', 'real', 'atletico', 'union', 'olympique', 'borussia', 'united', 'city', 'paris', 'c palace']);

// ESPN name (normalised, affixes dropped) -> how Spanish guides also write it.
const TEAM_ALIASES = {
  'atletico madrid': ['atletico de madrid', 'atleti'],
  'athletic': ['athletic bilbao', 'athletic club'],
  'celta vigo': ['celta', 'celta de vigo'],
  'racing santander': ['racing de santander', 'real racing'],
  'deportivo': ['deportivo de la coruna', 'deportivo la coruna', 'depor'],
  'alaves': ['deportivo alaves'],
  'rayo vallecano': ['rayo'],
  'real betis': ['betis'],
  'malaga': ['malaga cf'],
  'bayern munich': ['bayern munchen', 'bayern de munich', 'bayern'],
  'internazionale': ['inter', 'inter de milan', 'inter milan'],
  'milan': ['ac milan', 'milan'],
  'roma': ['as roma'],
  'napoli': ['napoles'],
  'juventus': ['juve'],
  'paris saint germain': ['psg', 'paris sg', 'paris saint germain'],
  'psv eindhoven': ['psv'],
  'manchester city': ['man city', 'manchester city'],
  'manchester united': ['man united', 'man utd', 'manchester utd'],
  'tottenham hotspur': ['tottenham', 'spurs'],
  'brighton and hove albion': ['brighton'],
  'newcastle united': ['newcastle'],
  'nottingham forest': ['nottingham', 'nottm forest'],
  'wolverhampton wanderers': ['wolves', 'wolverhampton'],
  'west ham united': ['west ham'],
  'leeds united': ['leeds'],
  'borussia dortmund': ['dortmund', 'bvb'],
  'borussia monchengladbach': ['gladbach', 'monchengladbach'],
  'bayer leverkusen': ['leverkusen'],
  'eintracht frankfurt': ['frankfurt'],
  'cologne': ['colonia', 'koln'],
  'werder bremen': ['bremen', 'werder'],
  'marseille': ['olympique de marsella', 'olympique de marseille', 'marsella'],
  'lyon': ['olympique de lyon', 'olympique lyonnais'],
  'stade rennais': ['rennes'],
  'sporting': ['sporting de portugal', 'sporting de lisboa', 'sporting cp'],
  'club brugge': ['brujas', 'club brujas'],
  'feyenoord rotterdam': ['feyenoord'],
  'shakhtar donetsk': ['shakhtar'],
  'slavia prague': ['slavia praga', 'slavia'],
  'sparta prague': ['sparta praga'],
  'aek athens': ['aek atenas', 'aek'],
  'olympiacos': ['olympiakos'],
  'salzburg': ['salzburgo', 'red bull salzburg'],
  'union st gilloise': ['union saint gilloise', 'saint gilloise'],
  'galatasaray': ['galatasaray'],
  'fenerbahce': ['fenerbahce'],
  // National teams, and countries for the Grand Prix names below.
  'spain': ['espana', 'seleccion espanola'],
  'germany': ['alemania'],
  'france': ['francia'],
  'italy': ['italia'],
  'england': ['inglaterra'],
  'netherlands': ['paises bajos', 'holanda'],
  'belgium': ['belgica'],
  'croatia': ['croacia'],
  'switzerland': ['suiza'],
  'denmark': ['dinamarca'],
  'turkiye': ['turquia'],
  'scotland': ['escocia'],
  'wales': ['gales'],
  'sweden': ['suecia'],
  'norway': ['noruega'],
  'poland': ['polonia'],
  'czechia': ['chequia', 'republica checa'],
  'greece': ['grecia'],
  'ukraine': ['ucrania'],
  'hungary': ['hungria'],
  'romania': ['rumania'],
  'republic of ireland': ['irlanda'],
  'northern ireland': ['irlanda del norte'],
  'iceland': ['islandia'],
  'finland': ['finlandia'],
  'slovakia': ['eslovaquia'],
  'slovenia': ['eslovenia'],
  'north macedonia': ['macedonia del norte'],
  'bosnia herzegovina': ['bosnia'],
  'luxembourg': ['luxemburgo'],
  'cyprus': ['chipre'],
  'moldova': ['moldavia'],
  'kazakhstan': ['kazajistan'],
  'azerbaijan': ['azerbaiyan'],
  'belarus': ['bielorrusia'],
  'latvia': ['letonia'],
  'lithuania': ['lituania'],
  'faroe islands': ['islas feroe'],
  'brazil': ['brasil'],
  'morocco': ['marruecos'],
  'japan': ['japon'],
  'united states': ['estados unidos', 'eeuu'],
};

// Words that place a programme in a competition (for one-team matches).
const COMPETITION_WORDS = {
  'esp.1': ['laliga', 'la liga', 'liga ea sports'],
  'eng.1': ['premier'],
  'ita.1': ['serie a', 'calcio'],
  'ger.1': ['bundesliga'],
  'fra.1': ['ligue 1', 'ligue'],
  'uefa.champions': ['champions', 'liga de campeones', 'ucl'],
  'uefa.europa': ['europa league', 'uefa europa'],
  'uefa.europa.conf': ['conference'],
  'uefa.super_cup': ['supercopa', 'super cup'],
  'esp.copa_del_rey': ['copa del rey', 'copa'],
  spain: ['nations league', 'liga de naciones', 'seleccion', 'amistoso', 'mundial', 'clasificacion'],
  atp: ['tenis', 'tennis', 'atp', 'masters', 'torneo', 'atp 500', 'atp 250'],
  wta: ['tenis', 'tennis', 'wta', 'torneo'],
  nfl: ['nfl', 'futbol americano'],
  nba: ['nba', 'baloncesto'],
};

// Grand Prix places: if an event mentions any term, a programme may use any other.
const GP_PLACES = [
  ['sao paulo', 'brasil', 'brazil', 'interlagos'],
  ['mexico', 'hermanos rodriguez'],
  ['las vegas', 'vegas'],
  ['qatar', 'catar', 'lusail'],
  ['abu dhabi', 'abu dabi', 'yas marina'],
  ['portugal', 'portimao', 'algarve'],
  ['valencia', 'comunitat valenciana', 'ricardo tormo', 'cheste'],
  ['united states', 'estados unidos', 'eeuu', 'austin', 'americas'],
  ['australia', 'melbourne', 'albert park', 'phillip island'],
  ['china', 'shanghai'],
  ['japan', 'japon', 'suzuka', 'motegi'],
  ['bahrain', 'bahrein', 'sakhir'],
  ['saudi', 'arabia saudi', 'arabia saudita', 'jeddah', 'yeda'],
  ['miami'],
  ['emilia romagna', 'imola'],
  ['monaco', 'montecarlo'],
  ['spain', 'espana', 'catalunya', 'cataluna', 'montmelo', 'madring'],
  ['canada', 'montreal'],
  ['austria', 'spielberg', 'red bull ring'],
  ['britain', 'british', 'gran bretana', 'silverstone'],
  ['belgium', 'belgica', 'spa francorchamps'],
  ['hungary', 'hungria', 'hungaroring', 'balaton'],
  ['netherlands', 'dutch', 'paises bajos', 'holanda', 'zandvoort', 'assen'],
  ['italy', 'italia', 'italian', 'monza', 'mugello'],
  ['azerbaijan', 'azerbaiyan', 'baku'],
  ['singapore', 'singapur', 'marina bay'],
  ['thailand', 'tailandia', 'buriram'],
  ['argentina', 'termas'],
  ['aragon', 'motorland'],
  ['germany', 'alemania', 'sachsenring'],
  ['czech', 'chequia', 'republica checa', 'brno'],
  ['indonesia', 'mandalika'],
  ['malaysia', 'malasia', 'sepang'],
  ['jerez', 'andalucia'],
  ['france', 'francia', 'le mans'],
  ['san marino', 'misano'],
];
// Tennis guides often name the tournament's city and the round, not the players.
const TENNIS_PLACES = [
  ['basel', 'basilea', 'swiss indoors'],
  ['vienna', 'viena', 'erste bank'],
  ['paris', 'bercy'],
  ['turin', 'atp finals', 'finales atp', 'nitto'],
  ['madrid', 'mutua madrid'],
  ['barcelona', 'conde de godo'],
  ['roland garros'],
  ['wimbledon'],
  ['us open', 'abierto de estados unidos'],
  ['australian open', 'abierto de australia'],
  ['indian wells'],
  ['miami'],
  ['monte carlo', 'montecarlo'],
  ['rome', 'roma', 'internazionali'],
  ['cincinnati'],
  ['shanghai'],
  ['beijing', 'pekin', 'china open'],
  ['tokyo', 'tokio'],
  ['guangzhou'],
  ['riyadh', 'riad'],
  ['metz'],
  ['athens', 'atenas'],
  ['stockholm', 'estocolmo'],
  ['antwerp', 'amberes'],
  ['brussels', 'bruselas'],
  ['hong kong'],
  ['davis cup', 'copa davis'],
  ['billie jean king', 'bjk cup'],
];
const ROUND_WORDS = [
  [/semi/i, ['semifinal', 'semifinales', 'semifinals']],
  [/quarter/i, ['cuartos', 'quarterfinal', 'quarterfinals']],
  [/^final$/i, ['final']],
];

const SESSION_WORDS = {
  race: ['carrera', 'race'],
  qualifying: ['clasificacion', 'qualifying', 'qualy', 'pole'],
  sprint: ['sprint'],
};
const SPORT_WORDS = {
  f1: ['f1', 'formula 1', 'formula one'],
  motogp: ['motogp', 'moto gp', 'motociclismo'],
};

// Highlights, previews and post-match shows: kept for the finder, never a "Watch" link.
const NOT_LIVE = /^\s*(?:\([^)]*\)\s*)?(?:(?:en )?directo:?\s+)?(?:res[uú]men(?:es)?|previa|post|highlights|lo mejor|la previa|repetici[oó]n|diferido|en diferido)\b/i;

// Best guess when the guide has nothing: channel names per competition, most likely first.
// Spanish TV rights change every season, so this is a guess by design and the UI labels
// it as one. Checked against this provider's channel names on 2026-11-01.
const CAMPEONES = /liga (?:de )?campeones/i;
const DAZN_N = /\bdazn [1-4]\b/i;
const GUESS = {
  'esp.1': [/dazn la ?liga/i, /m\+ la ?liga(?!.*hypermotion)/i],
  'esp.copa_del_rey': [/copa del rey/i],
  'uefa.champions': [CAMPEONES],
  'uefa.europa': [CAMPEONES, /europa league/i],
  'uefa.europa.conf': [CAMPEONES, /conference/i],
  'uefa.super_cup': [CAMPEONES],
  spain: [/teledeporte/i, /\bla ?1\b/i, /\btve\b/i],
  'eng.1': [DAZN_N, CAMPEONES],
  'ita.1': [DAZN_N, /m\+ vamos/i],
  'ger.1': [CAMPEONES, DAZN_N],
  'fra.1': [DAZN_N, /m\+ vamos/i],
  f1: [/dazn f1/i, /\bf1\b|formula/i],
  motogp: [/dazn moto ?gp/i, /moto ?gp/i],
  atp: [/m\+ vamos/i, /m\+ deportes?\b/i, /tennis channel/i, /eurosport/i],
  wta: [/m\+ vamos/i, /m\+ deportes?\b/i, /tennis channel/i, /eurosport/i],
  nfl: [DAZN_N, /nfl/i],
  nba: [/m\+ baloncesto/i, /m\+ vamos/i, /nba/i],
};

// ---------- Names ----------

const padded = (s) => ` ${s} `;

function stripAffixes(s) {
  let out = padded(s);
  DROP_PHRASES.forEach((p) => { out = out.replace(padded(p.trim()), ' '); });
  return out.split(' ').filter((w) => w && !AFFIXES.has(w)).join(' ');
}

// The phrases a team (or player) may appear as in a guide title.
function teamVariants(t, ev) {
  if (!t) return [];
  if (ev && ev.kind === 'players') {
    // Surname: the last word of the name ("Pablo Carreño Busta" -> "busta").
    const words = normTitle(t.name).split(' ');
    return [words.slice(1).join(' '), words[words.length - 1]].filter((w) => w && w.length > 2);
  }
  const base = stripAffixes(normTitle(t.name));
  const out = new Set([base, ...(TEAM_ALIASES[base] || [])]);
  const short = stripAffixes(normTitle(t.short));
  if (short) out.add(short);
  out.add(base.replace(/\s*\b\d+\b/g, '').trim()); // "Schalke 04" -> "schalke"
  const usable = [...out].filter((v) => v.length >= 3 && !AMBIGUOUS.has(v) && !/^\d+$/.test(v));
  return usable.length ? usable : [normTitle(t.name)]; // "Paris FC" stays "paris fc"
}

const hasAny = (text, phrases) => phrases.some((p) => text.includes(padded(p)));

// Whole-word team name match that ignores "X de Barcelona" (that's Espanyol, not Barça).
function hasTeam(text, phrase) {
  const needle = padded(phrase);
  let i = text.indexOf(needle);
  while (i >= 0) {
    if (!text.slice(Math.max(0, i - 3), i + 1).endsWith(' de ')) return true;
    i = text.indexOf(needle, i + 1);
  }
  return false;
}
const hasAnyTeam = (text, phrases) => phrases.some((p) => hasTeam(text, p));

// "|ES| DAZN 1 FHD", "ES: ...", "M+ VAMOS 2 FHD (ES)" -> "ES"; "" when untagged.
function countryOf(name) {
  const m = /^\s*\|([A-Z]{2,3})\||^\s*([A-Z]{2})\s*[:|]|\(([A-Z]{2})\)/.exec(String(name || ''));
  return m ? m[1] || m[2] || m[3] : '';
}
// 2 = tagged with the home country, 1 = untagged (often local, not always), 0 = foreign.
const homeScore = (name) => ({ [HOME_COUNTRY]: 2, '': 1 }[countryOf(name)] || 0);
const isHomeChannel = (name) => homeScore(name) > 0;

const groupTerms = (text, groups) => {
  const terms = new Set();
  groups.forEach((group) => { if (hasAny(text, group)) group.forEach((t) => terms.add(t)); });
  return [...terms];
};

function placeTerms(ev) {
  return groupTerms(padded(normTitle([ev.title, ev.shortTitle, ev.country, ev.venue].filter(Boolean).join(' '))), GP_PLACES);
}

const tennisPlaces = (ev) => groupTerms(padded(normTitle(ev.tournament)), TENNIS_PLACES);

// ---------- Matching ----------

// How strongly a programme title shows this event: 3 = sure, 2 = likely, 0 = no.
function matchStrength(ev, text, coversStart) {
  if (ev.kind === 'race') {
    const places = placeTerms(ev);
    if (!places.length || !hasAny(text, places)) return 0;
    if (hasAny(text, SESSION_WORDS[ev.sessionType] || [])) return 3;
    // Names another session ("Clasificación" at race time): not this one.
    if (Object.entries(SESSION_WORDS).some(([type, words]) => type !== ev.sessionType && hasAny(text, words))) return 0;
    return coversStart && hasAny(text, SPORT_WORDS[ev.league] || []) ? 2 : 0;
  }
  const home = hasAnyTeam(text, teamVariants(ev.home, ev));
  const away = hasAnyTeam(text, teamVariants(ev.away, ev));
  if (home && away) return 3;
  if ((home || away) && hasAny(text, COMPETITION_WORDS[ev.league] || [])) return 2;
  if (ev.kind === 'players') {
    // "Final T2026 · Torneo de Basilea": the tournament, and the round when it's named.
    // Needs a tennis word too, or "Paris" would find Paris FC.
    const places = tennisPlaces(ev);
    if (!places.length || !hasAny(text, places) || !hasAny(text, COMPETITION_WORDS[ev.league] || [])) return 0;
    const round = ROUND_WORDS.find(([re]) => re.test(ev.round || ''));
    if (round) return hasAny(text, round[1]) ? 2 : 0;
    return coversStart ? 2 : 0;
  }
  return 0;
}

// Index of the first programme starting at or after t (programmes sorted by start).
function lowerBound(programmes, t) {
  let lo = 0;
  let hi = programmes.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (programmes[mid].start < t) lo = mid + 1; else hi = mid;
  }
  return lo;
}

function candidates(programmes, kickoff) {
  const out = [];
  for (let i = lowerBound(programmes, kickoff - LONGEST_PROGRAMME_MS); i < programmes.length; i++) {
    const p = programmes[i];
    if (p.start > kickoff + WINDOW_MS) break;
    const near = Math.abs(p.start - kickoff) <= WINDOW_MS;
    const covers = p.start <= kickoff && p.end > kickoff;
    if (near || covers) out.push({ p, covers });
  }
  return out;
}

const folded = new WeakMap();
const textOf = (p) => {
  let t = folded.get(p);
  if (t === undefined) { t = padded(normTitle(p.title)); folded.set(p, t); }
  return t;
};

// programmes: [{ channel, start, end, title, streams }], sorted by start.
// Returns Map(event id -> [{ channel, title, start, end, streams, strength }]).
function matchEvents(events, programmes) {
  const strong = new Map();
  const weak = new Map();
  const usedByStrong = new Set();
  events.forEach((ev) => {
    candidates(programmes, ev.start).forEach(({ p, covers }) => {
      if (NOT_LIVE.test(p.title) || !p.streams || !p.streams.length) return;
      const strength = matchStrength(ev, textOf(p), covers);
      if (strength === 3) {
        (strong.get(ev.id) || strong.set(ev.id, []).get(ev.id)).push(p);
        usedByStrong.add(p);
      } else if (strength === 2) {
        (weak.get(ev.id) || weak.set(ev.id, []).get(ev.id)).push(p);
      }
    });
  });
  const out = new Map();
  events.forEach((ev) => {
    // A one-team match only counts if no other fixture claimed that programme for sure.
    const found = [
      ...(strong.get(ev.id) || []).map((p) => ({ p, strength: 3 })),
      ...(weak.get(ev.id) || []).filter((p) => !usedByStrong.has(p)).map((p) => ({ p, strength: 2 })),
    ];
    // Per channel, the programme on air at kick-off beats the preview before it.
    const fit = ({ p, strength }) => (3 - strength) * 1e10 + (p.start <= ev.start && p.end > ev.start ? 0 : 1) * 1e9 + Math.abs(p.start - ev.start);
    const byChannel = new Map();
    found.sort((a, b) => fit(a) - fit(b)).forEach((f) => { if (!byChannel.has(f.p.channel)) byChannel.set(f.p.channel, f); });
    // Local channels first: a sure match abroad matters less than a likely one at home.
    const where = [...byChannel.values()]
      .sort((a, b) => homeScore(b.p.streams[0].name) - homeScore(a.p.streams[0].name) || fit(a) - fit(b))
      .slice(0, MAX_WHERE)
      .map(({ p, strength }) => ({ confidence: 'guide', channel: p.streams[0].name, title: p.title, start: p.start, end: p.end, streams: p.streams, strength }));
    if (where.length) out.set(ev.id, where);
  });
  return out;
}

// Channel families (versions grouped) whose names fit the competition, most likely first.
function guessChannels(ev, streams, max = 6) {
  const patterns = GUESS[ev.league];
  if (!patterns) return [];
  const priority = (s) => patterns.findIndex((re) => re.test(s.name || ''));
  const fitting = (streams || []).filter((s) => priority(s) >= 0);
  // Only the best-placed channels: home-tagged ones if any, else untagged, else foreign.
  const best = Math.max(-1, ...fitting.map((s) => homeScore(s.name)));
  const families = new Map();
  fitting.filter((s) => homeScore(s.name) === best).forEach((s) => {
    const key = versionKey(s.name) || String(s.stream_id);
    (families.get(key) || families.set(key, []).get(key)).push(s);
  });
  return [...families.entries()]
    .map(([key, list]) => ({ key, list, p: Math.min(...list.map(priority)) }))
    .sort((a, b) => a.p - b.p || a.key.localeCompare(b.key, undefined, { numeric: true }))
    .slice(0, max)
    .map(({ list }) => {
      const sorted = list.slice().sort((a, b) => qualityRank(a.name) - qualityRank(b.name));
      return { confidence: 'guess', channel: sorted[0].name, streams: sorted };
    });
}

module.exports = { teamVariants, hasTeam, countryOf, isHomeChannel, matchStrength, matchEvents, guessChannels, placeTerms, NOT_LIVE, GUESS, TEAM_ALIASES };
