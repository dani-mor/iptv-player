// Reminders for matches and programmes: a toast with a Watch button 5 minutes before the
// start, and again at the start if it wasn't acted on. No desktop notifications and no
// automatic channel switching (the user's choice). Opened late, the app still shows it
// while the match is on.

import { toast } from './util.js';
import { library, updateReminder, pruneReminders } from './library.js';
import { sportsEvents } from './sports.js';
import { openTheater } from './theater.js';

const EARLY_MS = 5 * 60e3;
const SHOW_UNTIL_MS = 2 * 3600e3; // after the start, roughly while it's still on
const TOAST_MS = 8000;

// The channels to offer: a fixture's may have been found in the guide since it was set.
function streamsFor(r) {
  if (r.source === 'fixture') {
    const ev = sportsEvents().find((x) => `f:${x.id}` === r.id);
    const fresh = ev ? (ev.where || []).map((w) => w.streams[0]).filter(Boolean) : [];
    if (fresh.length) return fresh;
  }
  return r.streams || [];
}

function watch(r) {
  updateReminder(r.id, { acted: true });
  const streams = streamsFor(r);
  if (!streams.length) {
    toast(`No channel found for ${r.title} yet. Try the Sport Center or search.`, { duration: 6000 });
    return;
  }
  openTheater(streams[0], streams.length > 1 ? streams : null);
}

// Called on the 30 s tick and when the app becomes visible. One toast at a time.
export function checkReminders(now = Date.now()) {
  pruneReminders(now);
  const due = library.reminders
    .filter((r) => !r.acted && now < r.start + SHOW_UNTIL_MS && (
      (!r.shown && now >= r.start - EARLY_MS) || (r.shown === 'soon' && now >= r.start)))
    .sort((a, b) => a.start - b.start);
  const r = due[0];
  if (!r) return;
  const started = now >= r.start;
  updateReminder(r.id, { shown: started ? 'start' : 'soon' });
  const mins = Math.max(1, Math.round((r.start - now) / 60e3));
  const msg = started ? `${r.title} has started` : `${r.title} starts in ${mins} min`;
  toast(r.sub ? `${msg} · ${r.sub}` : msg, { label: 'Watch', duration: TOAST_MS, run: () => watch(r) });
}
