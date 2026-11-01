// When things are due: Sport Center refreshes and reminder toasts. Pure (no DOM, no
// storage), so it's tested in test/timing.test.mjs.

export const SPORTS_LIVE_REFRESH_MS = 60e3;
export const SPORTS_IDLE_REFRESH_MS = 10 * 60e3;
export const SPORTS_GUIDE_WAIT_REFRESH_MS = 20e3; // while the server is still building the guide index
const STARTING_SOON_MS = 5 * 60e3;

export const REMINDER_EARLY_MS = 5 * 60e3;
export const REMINDER_SHOW_UNTIL_MS = 2 * 3600e3; // after the start, roughly while it's still on

// data: the last /api/sports/home answer (or null); loadedAt: when the last load ended;
// current: whether that answer is for this account and these settings.
export function sportsRefreshDue({ data, loadedAt, current }, now = Date.now()) {
  if (!current) return true;
  const age = now - loadedAt;
  if (!data || !data.guide.builtAt) return age > SPORTS_GUIDE_WAIT_REFRESH_MS;
  const live = data.events.some((ev) => ev.state === 'in');
  const startingSoon = data.events.some((ev) => ev.state === 'pre' && ev.start - now < STARTING_SOON_MS);
  return age > (live || startingSoon ? SPORTS_LIVE_REFRESH_MS : SPORTS_IDLE_REFRESH_MS);
}

// The reminder to show now, if any: 5 min before the start ('soon'), then at the start
// ('start') unless it was acted on. The earliest one first; one at a time.
export function dueReminder(reminders, now = Date.now()) {
  const due = reminders
    .filter((r) => !r.acted && now < r.start + REMINDER_SHOW_UNTIL_MS && (
      (!r.shown && now >= r.start - REMINDER_EARLY_MS) || (r.shown === 'soon' && now >= r.start)))
    .sort((a, b) => a.start - b.start);
  if (!due.length) return null;
  const r = due[0];
  return { reminder: r, phase: now >= r.start ? 'start' : 'soon', mins: Math.max(1, Math.round((r.start - now) / 60e3)) };
}
