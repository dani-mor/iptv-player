// The user's library, per account, in localStorage: favourite channels, recently
// watched channels, continue-watching progress, watched episodes, hidden categories,
// match reminders and the Sport Center settings.

import { store } from './util.js';
import { session, accountKey } from './api.js';

const MAX_RECENTS = 24;
const blank = () => ({ favs: [], recents: [], progress: {}, episodes: {}, hiddenCats: {}, reminders: [], sports: null });

// Mutated in place so every module's import always sees the current library.
export const library = blank();

const libraryKey = () => `iptv_library:${accountKey()}`;
const listeners = new Set();

export const onLibraryChange = (fn) => listeners.add(fn);
const emit = () => listeners.forEach((fn) => fn());

export function loadLibrary() {
  const saved = store.get(libraryKey(), {});
  Object.assign(library, blank(), saved && typeof saved === 'object' ? saved : {});
}

export function saveLibrary() {
  store.set(libraryKey(), library);
}

// Each window saves the whole library, so pick up other windows' saves right away;
// otherwise two open windows would overwrite each other's favourites and progress.
window.addEventListener('storage', (e) => {
  if (!session.creds || e.key !== libraryKey()) return;
  loadLibrary();
  emit();
});

const channelRef = (ch) => ({ stream_id: ch.stream_id, name: ch.name, stream_icon: ch.stream_icon, category_id: ch.category_id });

export const isFav = (id) => library.favs.some((f) => String(f.stream_id) === String(id));

export function toggleFav(ch) {
  if (isFav(ch.stream_id)) {
    library.favs = library.favs.filter((f) => String(f.stream_id) !== String(ch.stream_id));
  } else {
    library.favs.push(channelRef(ch));
  }
  saveLibrary();
  emit();
}

export function addRecent(ch) {
  library.recents = [channelRef(ch), ...library.recents.filter((r) => String(r.stream_id) !== String(ch.stream_id))].slice(0, MAX_RECENTS);
  saveLibrary();
}

export const isCatHidden = (type, id) => (library.hiddenCats[type] || []).includes(String(id));

export function setCatHidden(type, id, hidden) {
  const list = (library.hiddenCats[type] || []).filter((x) => x !== String(id));
  if (hidden) list.push(String(id));
  library.hiddenCats = { ...library.hiddenCats, [type]: list };
  saveLibrary();
}

export function continueEntries(kind) {
  return Object.values(library.progress)
    .filter((p) => p.kind === kind)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function removeContinue(key) {
  delete library.progress[key];
  saveLibrary();
  emit();
}

// ---------- Reminders ----------
// { id, title, sub, start, streams: [channel refs, best first], source: "fixture" | "programme",
//   shown: "" | "soon" | "start", acted }

const REMINDER_KEEP_MS = 3 * 3600e3;

export const hasReminder = (id) => library.reminders.some((r) => r.id === id);

export function toggleReminder(r) {
  if (hasReminder(r.id)) {
    library.reminders = library.reminders.filter((x) => x.id !== r.id);
  } else {
    library.reminders = [...library.reminders, { ...r, streams: (r.streams || []).slice(0, 6).map(channelRef), shown: '', acted: false }];
  }
  saveLibrary();
  emit();
  return hasReminder(r.id);
}

export function updateReminder(id, changes) {
  const r = library.reminders.find((x) => x.id === id);
  if (!r) return;
  Object.assign(r, changes);
  saveLibrary();
}

// Drops reminders for things that started more than 3 hours ago.
export function pruneReminders(now = Date.now()) {
  const kept = library.reminders.filter((r) => now - r.start < REMINDER_KEEP_MS);
  if (kept.length === library.reminders.length) return;
  library.reminders = kept;
  saveLibrary();
  emit();
}

// ---------- Sport Center settings ----------

export const DEFAULT_TEAMS = ['Real Madrid', 'Spain'];

// leagues: null = every competition the server offers.
export const sportsSettings = () => ({ teams: DEFAULT_TEAMS, leagues: null, spanishAthletes: true, ...(library.sports || {}) });

export function setSportsSettings(changes) {
  library.sports = { ...sportsSettings(), ...changes };
  saveLibrary();
  emit();
}

// ---------- Volume (shared by every player, all accounts) ----------

const VOLUME_KEY = 'iptv_volume';

// Applies the saved volume and saves the user's changes from then on.
export function bindVolume(video) {
  const saved = store.get(VOLUME_KEY, { volume: 1, muted: false });
  const vol = Number(saved.volume);
  video.volume = Number.isFinite(vol) ? Math.min(1, Math.max(0, vol)) : 1;
  video.muted = !!saved.muted;
  video.addEventListener('volumechange', () => store.set(VOLUME_KEY, { volume: video.volume, muted: video.muted }));
}

export const savedVolume = () => store.get(VOLUME_KEY, { volume: 1, muted: false });
