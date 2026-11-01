// MotoGP isn't on ESPN; MotoGP's own results API (Pulselive, no key) has the calendar
// and session times. Returns the same Event shape as lib/sports.js.

const { cachedJson } = require('./sports');

const API = 'https://api.motogp.pulselive.com/motogp/v1/results';
const DAYS_AHEAD = 7;
// Sessions worth a card, and roughly how long they last (the API only gives start times).
const SESSIONS = {
  Q2: { label: 'Qualifying', type: 'qualifying', mins: 15 },
  SPR: { label: 'Sprint', type: 'sprint', mins: 25 },
  RAC: { label: 'Race', type: 'race', mins: 45 },
};

const ttl = (ms) => () => ms;

function sessionState(s, start, now) {
  const status = String(s.status || '').toUpperCase();
  const end = start + SESSIONS[s.key].mins * 60e3;
  if (status === 'FINISHED' || now >= end + 15 * 60e3) return 'post';
  if (now >= start) return 'in';
  return 'pre';
}

async function fetchMotoGpEvents(now = Date.now()) {
  const seasons = await cachedJson(`${API}/seasons`, ttl(24 * 3600e3));
  const season = (seasons || []).find((s) => s.current);
  if (!season) return [];
  const events = await cachedJson(`${API}/events?seasonUuid=${season.id}&isFinished=false`, ttl(6 * 3600e3));
  const soon = (events || []).filter((e) => !e.test
    && Date.parse(e.date_start) < now + DAYS_AHEAD * 24 * 3600e3
    && Date.parse(e.date_end) + 2 * 24 * 3600e3 > now);
  const out = [];
  for (const e of soon) {
    const cats = await cachedJson(`${API}/categories?eventUuid=${e.id}`, ttl(24 * 3600e3));
    const motogp = (cats || []).find((c) => /^motogp/i.test(c.name || ''));
    if (!motogp) continue;
    const sessions = await cachedJson(`${API}/sessions?eventUuid=${e.id}&categoryUuid=${motogp.id}`, ttl(30 * 60e3));
    (sessions || []).forEach((s) => {
      const key = `${s.type}${s.type === 'Q' ? s.number : ''}`;
      if (!SESSIONS[key]) return;
      const start = Date.parse(s.date);
      if (!Number.isFinite(start)) return;
      const info = SESSIONS[key];
      out.push({
        id: `motogp:${s.id || `${e.id}:${key}`}`,
        league: 'motogp',
        leagueName: 'MotoGP',
        group: 'motogp',
        kind: 'race',
        start,
        state: sessionState({ ...s, key }, start, now),
        clock: '',
        detail: '',
        title: e.sponsored_name || e.name || 'Grand Prix',
        // e.g. "GRAND PRIX OF QATAR"; the matcher reads the country from it.
        shortTitle: e.name || '',
        country: (e.country && e.country.name) || '',
        session: info.label,
        sessionType: info.type,
        venue: (e.circuit && e.circuit.name) || '',
      });
    });
  }
  return out;
}

module.exports = { fetchMotoGpEvents };
