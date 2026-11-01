// Match finder: on Home, the top-bar search looks everywhere: every programme in the
// provider's sports guide (server-side index), this week's fixtures and the channels.
// Results drop down under the search box, grouped by when they're on.

import { $, escapeHtml, fmtTime, debounce, toast } from './util.js';
import { apiServer } from './api.js';
import { nav, onViewChange } from './views.js';
import { fold, matchesQuery, parseChannelName, versionKey, qualityRank } from './names.js';
import { livePool, loadAll, allLoaded } from './catalog.js';
import { hasReminder, toggleReminder } from './library.js';
import { nowProgram } from './epg.js';
import { badgesHtml } from './channels.js';
import { sportsEvents, eventTitle, reminderFor, watchChannel, dayName } from './sports.js';

const MIN_QUERY = 2;
const MAX_CHANNELS = 6;
const MAX_FIXTURES = 5;
const MAX_PROGRAMMES = 30;
const RETRY_MS = 3000; // while the server is still building the guide index
const MAX_RETRIES = 20;
const HOME_PLACEHOLDER = 'Find a match, team or channel';

const el = { box: $('#search-box'), list: $('#finder') };

let items = []; // what's listed, in order: { kind, ..., run(), action }
let selected = -1;
let seq = 0;
let openedHere = false; // opened on a catalogue tab with "Search everywhere"
let retryTimer = null;

const isOpen = () => !el.list.hidden;

function close() {
  clearTimeout(retryTimer);
  seq += 1;
  el.list.hidden = true;
  el.list.innerHTML = '';
  el.box.setAttribute('aria-expanded', 'false');
  items = [];
  selected = -1;
  openedHere = false;
}

// ---------- Collecting results ----------

const words = (q) => fold(q).split(/[^a-z0-9+]+/).filter(Boolean);

// Channel names, one entry per channel (the best of its versions).
function channelHits(q) {
  const folded = fold(q.trim());
  const families = new Map();
  livePool().filter((ch) => matchesQuery(ch, folded)).forEach((ch) => {
    const key = versionKey(ch.name) || String(ch.stream_id);
    const best = families.get(key);
    if (!best || qualityRank(ch.name) < qualityRank(best.name)) families.set(key, ch);
  });
  return [...families.values()].slice(0, MAX_CHANNELS);
}

// This week's fixtures from the Sport Center whose teams / names contain every word.
function fixtureHits(q) {
  const want = words(q);
  return sportsEvents().filter((ev) => {
    const text = fold([eventTitle(ev), ev.leagueName, ev.tournament, ev.venue].filter(Boolean).join(' '));
    return ev.state !== 'post' && want.every((w) => text.includes(w));
  }).slice(0, MAX_FIXTURES);
}

function groupOf(start, end, now = Date.now()) {
  if (start <= now && end > now) return 'On now';
  if (end <= now) return 'Earlier';
  const day = dayName(start, now);
  return day === 'Today' ? 'Later today' : day === 'Tomorrow' ? 'Tomorrow' : new Date(start).toLocaleDateString([], { weekday: 'long' });
}

const channelHtml = (name) => {
  const { title, tags } = parseChannelName(name);
  return `${escapeHtml(title)}${badgesHtml(tags.slice(0, 1))}`;
};

function programmeItem(p, now) {
  const live = p.start <= now && p.end > now;
  const future = p.start > now;
  const id = `p:${p.streams[0] ? p.streams[0].stream_id : p.channel}:${p.start}`;
  const versions = [...new Set(p.streams.map((s) => parseChannelName(s.name).quality).filter(Boolean))];
  return {
    group: groupOf(p.start, p.end, now),
    sortKey: p.start,
    time: fmtTime(p.start),
    title: p.title,
    sub: `${channelHtml(p.channel)}${versions.length > 1 ? ` · ${escapeHtml(versions.join(', '))}` : ''}${live ? ` · until ${escapeHtml(fmtTime(p.end))}` : ''}`,
    action: () => (live ? 'Watch' : future ? (hasReminder(id) ? 'Reminder set' : 'Remind me') : 'Channel'),
    live,
    run: () => {
      if (!p.streams.length) return;
      if (!future) { watchChannel(p.streams[0], p.streams); return 'close'; }
      const on = toggleReminder({ id, title: p.title, sub: parseChannelName(p.channel).title, start: p.start, streams: p.streams, source: 'programme' });
      toast(on ? `We'll remind you 5 min before “${p.title}”.` : 'Reminder removed.');
      return 'keep';
    },
  };
}

function fixtureItem(ev, now) {
  const guide = (ev.where || []).filter((w) => w.confidence === 'guide');
  const streams = (ev.where || []).map((w) => w.streams[0]).filter(Boolean);
  const live = ev.state === 'in';
  const r = reminderFor(ev);
  const where = guide.length ? channelHtml(guide[0].channel) : streams.length ? 'not in your guide yet' : 'no channel found';
  return {
    group: live ? 'On now' : groupOf(ev.start, ev.start + 2 * 3600e3, now),
    sortKey: ev.start,
    time: fmtTime(ev.start),
    title: eventTitle(ev),
    sub: `${escapeHtml(ev.leagueName)} · ${where}`,
    action: () => (live && streams.length ? 'Watch' : hasReminder(r.id) ? 'Reminder set' : 'Remind me'),
    live,
    run: () => {
      if (live) {
        if (streams.length) { watchChannel(streams[0], streams); return 'close'; }
        return 'keep';
      }
      const on = toggleReminder(r);
      toast(on ? `We'll remind you 5 min before ${r.title}.` : 'Reminder removed.');
      return 'keep';
    },
  };
}

function channelItem(ch) {
  const p = nowProgram(ch.stream_id);
  return {
    group: 'Channels',
    time: '',
    title: '',
    titleHtml: channelHtml(ch.name),
    sub: p ? escapeHtml(p.title) : 'Live TV',
    action: () => 'Watch',
    live: false,
    run: () => { watchChannel(ch, null); return 'close'; },
  };
}

// ---------- Rendering ----------

const GROUP_ORDER = ['On now', 'Later today', 'Tomorrow'];
const groupRank = (g) => {
  if (g === 'Channels') return 99;
  if (g === 'Earlier') return 98;
  const i = GROUP_ORDER.indexOf(g);
  return i >= 0 ? i : 10;
};

function render(state) {
  const now = Date.now();
  const timed = [
    ...state.fixtures.map((ev) => fixtureItem(ev, now)),
    ...state.programmes.slice(0, MAX_PROGRAMMES).map((p) => programmeItem(p, now)),
  ].sort((a, b) => groupRank(a.group) - groupRank(b.group) || (a.group === 'Earlier' ? b.sortKey - a.sortKey : a.sortKey - b.sortKey));
  items = [...timed, ...state.channels.map(channelItem)];
  selected = Math.min(Math.max(selected, items.length ? 0 : -1), items.length - 1);

  el.list.innerHTML = '';
  let lastGroup = '';
  items.forEach((it, i) => {
    if (it.group !== lastGroup) {
      el.list.insertAdjacentHTML('beforeend', `<div class="finder-group">${escapeHtml(it.group)}</div>`);
      lastGroup = it.group;
    }
    const row = document.createElement('div');
    row.className = `finder-hit${i === selected ? ' sel' : ''}`;
    row.setAttribute('role', 'option');
    row.id = `finder-hit-${i}`;
    row.innerHTML = `<span class="hit-time">${escapeHtml(it.time || '—')}</span>
      <div class="hit-what"><b>${it.titleHtml || escapeHtml(it.title)}</b><span>${it.sub}</span></div>
      <span class="hit-act${it.live ? ' live' : ''}">${it.live ? '● ' : ''}${escapeHtml(it.action())}</span>`;
    row.addEventListener('mousedown', (e) => e.preventDefault()); // keep the focus in the box
    row.addEventListener('mousemove', () => { if (selected !== i) select(i); });
    row.addEventListener('click', () => activate(i));
    el.list.appendChild(row);
  });
  if (state.message) el.list.insertAdjacentHTML('beforeend', `<div class="finder-msg">${escapeHtml(state.message)}</div>`);
  if (!items.length && !state.message) el.list.insertAdjacentHTML('beforeend', `<div class="finder-msg">Nothing found for “${escapeHtml(state.q)}”.</div>`);
  el.list.insertAdjacentHTML('beforeend', '<div class="finder-foot">↑ ↓ to move · Enter to watch or set a reminder · Esc to close</div>');
  el.list.hidden = false;
  el.box.setAttribute('aria-expanded', 'true');
  el.box.setAttribute('aria-activedescendant', selected >= 0 ? `finder-hit-${selected}` : '');
}

function select(i) {
  const rows = el.list.querySelectorAll('.finder-hit');
  rows.forEach((r, j) => r.classList.toggle('sel', j === i));
  selected = i;
  if (rows[i]) rows[i].scrollIntoView({ block: 'nearest' });
  el.box.setAttribute('aria-activedescendant', i >= 0 ? `finder-hit-${i}` : '');
}

function activate(i) {
  const it = items[i];
  if (!it) return;
  const what = it.run();
  if (what === 'close') {
    close();
    el.box.value = '';
    el.box.blur();
  } else {
    const row = el.list.querySelectorAll('.finder-hit')[i];
    if (row) row.querySelector('.hit-act').textContent = `${it.live ? '● ' : ''}${it.action()}`;
  }
}

// ---------- Searching ----------

async function run(q, attempt = 0) {
  clearTimeout(retryTimer);
  q = q.trim();
  if (q.length < MIN_QUERY) { if (!openedHere) close(); return; }
  const my = ++seq;
  const base = { q, channels: channelHits(q), fixtures: fixtureHits(q), programmes: [] };
  if (!attempt) render({ ...base, message: 'Searching the guide…' });
  if (!allLoaded('live')) loadAll('live').then(() => { if (my === seq && isOpen()) run(el.box.value); }).catch(() => {});
  let message = '';
  try {
    const res = await apiServer('/api/guide/search', { q });
    if (my !== seq) return;
    base.programmes = res.results;
    if (!res.builtAt) {
      message = res.error ? `Couldn't read your provider's guide: ${res.error}` : 'Reading your provider\'s guide… programmes will show up in a moment.';
      if (!res.error && attempt < MAX_RETRIES) retryTimer = setTimeout(() => { if (my === seq) run(q, attempt + 1); }, RETRY_MS);
    }
  } catch (err) {
    if (my !== seq) return;
    message = `Guide search failed: ${err.message}`;
  }
  render({ ...base, message });
}

// From a catalogue tab: "Search everywhere for …".
export function openFinder(q) {
  openedHere = true;
  el.box.focus();
  el.box.value = q;
  run(q);
}

export const finderOpen = isOpen;

export function initFinder() {
  const onInput = debounce(() => {
    if (nav.view === 'home' || openedHere) run(el.box.value);
  }, 200);
  el.box.addEventListener('input', onInput);
  el.box.addEventListener('focus', () => {
    if (nav.view === 'home' && el.box.value.trim().length >= MIN_QUERY && !isOpen()) run(el.box.value);
  });
  el.box.addEventListener('keydown', (e) => {
    if (!isOpen()) {
      // Closed with Esc, still typed in: Enter or ↓ brings the results back.
      if ((e.key === 'Enter' || e.key === 'ArrowDown') && nav.view === 'home' && el.box.value.trim().length >= MIN_QUERY) {
        e.preventDefault();
        run(el.box.value);
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (items.length) select((selected + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      activate(selected >= 0 ? selected : 0);
    } else if (e.key === 'Escape') {
      // First Esc closes the results; the next one clears the box (main.js).
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === 'Tab') {
      close();
    }
  });
  document.addEventListener('mousedown', (e) => {
    if (isOpen() && !el.list.contains(e.target) && e.target !== el.box) close();
  });

  // The catalogue tabs set their own placeholder ("Search Movies").
  onViewChange((prev, next) => {
    close();
    if (next === 'home' && prev !== 'home') {
      el.box.value = '';
      el.box.placeholder = HOME_PLACEHOLDER;
    }
  });
  el.box.placeholder = HOME_PLACEHOLDER;
}
