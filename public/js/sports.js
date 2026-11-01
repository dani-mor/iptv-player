// Sport Center on Home: the main match and a row of ranked matches from /api/sports/home,
// each saying which of the user's channels shows it ("in guide") or a labelled best guess.
// Also the settings sheet (teams, competitions) and reminders for matches.

import { $, icon, escapeHtml, fmtTime, toast } from './util.js';
import { apiServer, session, accountKey } from './api.js';
import { nav } from './views.js';
import { sportsSettings, setSportsSettings, hasReminder, toggleReminder } from './library.js';
import { badgesHtml } from './channels.js';
import { parseChannelName } from './names.js';
import { openTheater } from './theater.js';
import { openMultiview } from './multiview.js';

const LIVE_REFRESH_MS = 60e3;
const IDLE_REFRESH_MS = 10 * 60e3;
const GUIDE_WAIT_REFRESH_MS = 20e3; // while the server is still building the guide index
const MAX_WHERE_SHOWN = 3;
const SOON_MS = 15 * 60e3; // "Watch" appears this long before the start
const GROUPS = [
  ['football', 'Football'], ['tennis', 'Tennis'], ['f1', 'F1'], ['motogp', 'MotoGP'], ['nfl', 'NFL'], ['nba', 'NBA'],
];

const el = {
  featured: $('#home-featured'),
  section: $('#home-sports'),
  chips: $('#sport-chips'),
  row: $('#sport-row'),
  note: $('#sport-note'),
  edit: $('#sport-edit'),
  sheet: $('#sport-sheet'),
  sheetClose: $('#sport-sheet-close'),
  teams: $('#sport-teams'),
  teamForm: $('#sport-team-form'),
  teamInput: $('#sport-team-input'),
  leagues: $('#sport-leagues'),
  athletes: $('#sport-athletes'),
};

let data = null; // last answer: { featured, events, guide, errors, leagues }
let dataKey = ''; // account + settings the answer is for
let loadedAt = 0;
let loading = null;
let failed = '';
let filter = 'all';

export const sportsEvents = () => (data ? data.events : []);

const settingsKey = () => `${session.creds ? accountKey() : ''}|${JSON.stringify(sportsSettings())}`;

function load() {
  if (loading) return loading;
  const s = sportsSettings();
  const key = settingsKey();
  loading = apiServer('/api/sports/home', {
    teams: s.teams.join('|'),
    leagues: s.leagues ? s.leagues.join(',') : '',
    athletes: s.spanishAthletes ? '1' : '0',
  })
    .then((fresh) => {
      if (key !== settingsKey()) return;
      data = fresh;
      dataKey = key;
      failed = '';
    })
    .catch((err) => { failed = err.message; })
    .finally(() => {
      loadedAt = Date.now();
      loading = null;
      if (nav.view === 'home') renderSports();
    });
  return loading;
}

export function resetSports() {
  data = null;
  dataKey = '';
  loadedAt = 0;
  filter = 'all';
}

function refreshDue() {
  if (dataKey !== settingsKey()) return true;
  if (!data) return Date.now() - loadedAt > GUIDE_WAIT_REFRESH_MS;
  const age = Date.now() - loadedAt;
  if (!data.guide.builtAt) return age > GUIDE_WAIT_REFRESH_MS;
  const live = data.events.some((ev) => ev.state === 'in');
  const startingSoon = data.events.some((ev) => ev.state === 'pre' && ev.start - Date.now() < 5 * 60e3);
  return age > (live || startingSoon ? LIVE_REFRESH_MS : IDLE_REFRESH_MS);
}

// Every 30 s on Home, and on coming back to it: refresh live scores when due, and keep
// times and countdowns current.
export function tickSports() {
  if (refreshDue()) load();
  else renderSports();
}

// ---------- Labels ----------

const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();

export function dayName(ms, now = Date.now()) {
  if (sameDay(ms, now)) return 'Today';
  if (sameDay(ms, now + 24 * 3600e3)) return 'Tomorrow';
  return new Date(ms).toLocaleDateString([], { weekday: 'short' });
}

function untilLabel(ms) {
  const mins = Math.max(1, Math.round((ms - Date.now()) / 60e3));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return mins % 60 ? `${h} h ${mins % 60} min` : `${h} h`;
}

export const eventTitle = (ev) => (ev.kind === 'race'
  ? `${ev.title} · ${ev.session}`
  : `${ev.home.name} – ${ev.away.name}`);

const eventSub = (ev) => [ev.leagueName, ev.kind === 'players' ? [ev.tournament, ev.round].filter(Boolean).join(' · ') : ev.round]
  .filter(Boolean).join(' · ');

// The status pill: LIVE · 78', Today · 21:00, In 20 min, Finished.
function statusPill(ev) {
  if (ev.state === 'in') {
    const clock = ev.kind === 'teams' && ev.group === 'football' ? ev.clock : ev.detail;
    return `<span class="tag live"><span class="dot"></span>LIVE${clock ? ` · ${escapeHtml(clock)}` : ''}</span>`;
  }
  if (ev.state === 'post') return '<span class="tag">Finished</span>';
  if (ev.timeKnown === false) return `<span class="tag">${escapeHtml(dayName(ev.start))} · time TBC</span>`;
  if (ev.start - Date.now() < 60 * 60e3) return `<span class="tag soon">In ${escapeHtml(untilLabel(ev.start))}</span>`;
  return `<span class="tag${sameDay(ev.start, Date.now()) ? ' soon' : ''}">${escapeHtml(dayName(ev.start))} · ${escapeHtml(fmtTime(ev.start))}</span>`;
}

const tagPills = (ev) => [
  ev.tags.includes('your-team') ? `<span class="tag hot">${icon('star', true)}Your team</span>` : '',
  ev.tags.includes('top-match') ? '<span class="tag hot">Top match</span>' : '',
].join('');

// ---------- Crests ----------

// ESPN serves 500 px logos; its image combiner returns small ones.
const smallLogo = (url) => (/^https:\/\/a\.espncdn\.com\/i\//.test(url)
  ? `https://a.espncdn.com/combiner/i?img=${encodeURIComponent(url.slice('https://a.espncdn.com'.length))}&w=96&h=96`
  : url);

function initials(side) {
  if (side.abbr) return side.abbr.slice(0, 3);
  return String(side.name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
}

function crest(side, size = '') {
  const node = document.createElement('span');
  node.className = `crest ${size}`;
  node.textContent = initials(side);
  if (side.logo) {
    const img = new Image();
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.onload = () => { node.textContent = ''; node.classList.add('has-img'); node.appendChild(img); };
    img.onerror = () => { if (img.src !== side.logo) img.src = side.logo; };
    img.src = smallLogo(side.logo);
  }
  return node;
}

// ---------- Watching ----------

// The best version of each channel that shows the event, guide matches first.
const channelsFor = (ev) => (ev.where || []).map((w) => w.streams[0]).filter(Boolean);

export function watchChannel(stream, rail) {
  openTheater(stream, rail && rail.length > 1 ? rail : null);
}

function watchEvent(ev, stream = channelsFor(ev)[0]) {
  if (stream) watchChannel(stream, channelsFor(ev));
}

// This match plus the other live ones, one tile each.
function multiviewFrom(ev) {
  const others = data.events.filter((x) => x !== ev && x.state === 'in' && (x.where || []).some((w) => w.confidence === 'guide'));
  const tiles = [ev, ...others].map((x) => channelsFor(x)[0]).filter(Boolean);
  openMultiview(tiles.filter((t, i) => tiles.findIndex((u) => String(u.stream_id) === String(t.stream_id)) === i));
}

export const reminderFor = (ev) => ({
  id: `f:${ev.id}`,
  title: eventTitle(ev),
  sub: ev.leagueName,
  start: ev.start,
  streams: channelsFor(ev),
  source: 'fixture',
});

function reminderButton(ev, cls = 'action-btn') {
  const b = document.createElement('button');
  const paint = () => {
    const on = hasReminder(`f:${ev.id}`);
    b.className = `${cls}${on ? ' on' : ''}`;
    b.innerHTML = `${icon(on ? 'check' : 'bell')}<span>${on ? 'Reminder set' : 'Remind me'}</span>`;
    b.title = on ? 'Remove the reminder' : 'Get a reminder 5 minutes before the start';
  };
  paint();
  b.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = toggleReminder(reminderFor(ev));
    paint();
    toast(on ? `We'll remind you 5 min before ${eventTitle(ev)}.` : 'Reminder removed.');
  });
  return b;
}

function button(label, iconName, onClick, cls = 'action-btn') {
  const b = document.createElement('button');
  b.className = cls;
  b.innerHTML = `${iconName ? icon(iconName, iconName === 'play') : ''}<span>${label}</span>`;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

// Name + quality; a foreign copy ("FR: DAZN 1") also shows its country, since the
// cleaned-up name alone would look like the local channel.
export const channelLabel = (name, foreign = '') => {
  const { title, tags } = parseChannelName(name);
  return `<span class="ch-title-text">${escapeHtml(title)}</span>${badgesHtml(tags.slice(0, 1))}${foreign ? `<span class="q-badge country">${escapeHtml(foreign)}</span>` : ''}`;
};

const watchable = (ev) => ev.state === 'in' || (ev.state === 'pre' && ev.start - Date.now() < SOON_MS);

// ---------- Event cards ----------

function lineup(ev) {
  const box = document.createElement('div');
  box.className = 'lineup';
  if (ev.kind === 'race') {
    box.innerHTML = `<div class="race-title"></div><div class="race-sub"></div>`;
    box.firstChild.textContent = ev.title;
    box.lastChild.textContent = [ev.session, ev.venue].filter(Boolean).join(' · ');
    return box;
  }
  [ev.home, ev.away].forEach((side) => {
    const row = document.createElement('div');
    row.className = 'side';
    row.appendChild(crest(side, 'sm'));
    row.insertAdjacentHTML('beforeend', `<span class="side-name"></span>${ev.state !== 'pre' && side.score !== '' ? `<span class="score">${escapeHtml(side.score)}</span>` : ''}`);
    row.querySelector('.side-name').textContent = side.name;
    box.appendChild(row);
  });
  return box;
}

function whereBlock(ev) {
  const box = document.createElement('div');
  box.className = 'where';
  const where = ev.where || [];
  const guide = where.filter((w) => w.confidence === 'guide');
  const label = guide.length ? 'On your channels' : where.length ? 'Not in your guide' : 'No channel found';
  box.innerHTML = `<div class="where-label">${label}</div>`;
  where.slice(0, MAX_WHERE_SHOWN).forEach((w) => {
    const row = document.createElement('button');
    row.className = `where-ch${w.confidence === 'guess' ? ' guess' : ''}`;
    row.title = w.confidence === 'guide' ? `${w.channel}\n${w.title}` : `${w.channel}: a guess from the channel name`;
    row.innerHTML = `<span class="where-name">${channelLabel(w.channel, w.foreign)}</span><span class="conf">${w.confidence === 'guide' ? 'in guide' : 'best guess'}</span>`;
    row.addEventListener('click', (e) => { e.stopPropagation(); watchEvent(ev, w.streams[0]); });
    box.appendChild(row);
  });
  if (where.length > MAX_WHERE_SHOWN) box.insertAdjacentHTML('beforeend', `<div class="where-more">+${where.length - MAX_WHERE_SHOWN} more: ↑ ↓ in the player</div>`);
  return box;
}

function eventCard(ev) {
  const card = document.createElement('article');
  card.className = `event-card${ev.state === 'in' ? ' is-live' : ''}`;
  card.innerHTML = `<div class="event-top">${statusPill(ev)}${tagPills(ev)}<span class="event-league"></span></div>`;
  card.querySelector('.event-league').textContent = ev.kind === 'players' ? ev.tournament || ev.leagueName : ev.leagueName;
  card.appendChild(lineup(ev));
  if (ev.kind === 'players' && ev.round) card.insertAdjacentHTML('beforeend', `<div class="event-round">${escapeHtml(ev.round)}</div>`);
  if (ev.state !== 'post') card.appendChild(whereBlock(ev));
  const actions = document.createElement('div');
  actions.className = 'event-actions';
  if (watchable(ev) && channelsFor(ev).length) actions.appendChild(button('Watch', 'play', () => watchEvent(ev), 'action-btn primary small'));
  if (ev.state === 'in' && channelsFor(ev).length) actions.appendChild(button('Multiview', 'multiview', () => multiviewFrom(ev), 'action-btn small'));
  if (ev.state === 'pre') actions.appendChild(reminderButton(ev, 'action-btn small'));
  if (actions.children.length) card.appendChild(actions);
  return card;
}

// ---------- Main match ----------

function renderFeatured(ev) {
  const box = el.featured;
  box.hidden = !ev;
  box.innerHTML = '';
  if (!ev) return;
  box.classList.toggle('is-live', ev.state === 'in');

  const left = document.createElement('div');
  left.className = 'featured-main';
  left.innerHTML = `<div class="featured-tags">${statusPill(ev)}<span class="tag comp"></span>${tagPills(ev)}</div>`;
  left.querySelector('.tag.comp').textContent = eventSub(ev) || ev.leagueName;
  const versus = document.createElement('div');
  versus.className = 'versus';
  if (ev.kind === 'race') {
    versus.innerHTML = '<b class="race-name"></b>';
    versus.firstChild.textContent = `${ev.title} · ${ev.session}`;
  } else {
    [ev.home, ev.away].forEach((side, i) => {
      if (i) versus.insertAdjacentHTML('beforeend', '<span class="vs">vs</span>');
      const t = document.createElement('div');
      t.className = 'team';
      t.appendChild(crest(side));
      t.insertAdjacentHTML('beforeend', '<b></b>');
      t.querySelector('b').textContent = side.name;
      versus.appendChild(t);
    });
  }
  left.appendChild(versus);
  const when = new Date(ev.start).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  left.insertAdjacentHTML('beforeend', '<div class="featured-meta"></div>');
  left.lastChild.textContent = [`${when} · ${fmtTime(ev.start)}`, ev.venue].filter(Boolean).join(' · ');

  const right = document.createElement('div');
  right.className = 'featured-watch';
  if (ev.state === 'in' && ev.kind !== 'race') {
    right.innerHTML = `<div class="big-number">${escapeHtml(ev.home.score)} – ${escapeHtml(ev.away.score)}<small>${escapeHtml(ev.clock || ev.detail || 'Live')}</small></div>`;
  } else if (ev.state === 'pre' && ev.start - Date.now() < 24 * 3600e3) {
    right.innerHTML = `<div class="big-number">${escapeHtml(untilLabel(ev.start))}<small>to the start</small></div>`;
  }
  const guide = (ev.where || []).filter((w) => w.confidence === 'guide');
  const list = ev.where || [];
  right.insertAdjacentHTML('beforeend', `<div class="where-label">${guide.length ? 'Watch on your channels' : list.length ? 'Best guess, not in your guide' : 'No channel found yet'}</div>`);
  const buttons = document.createElement('div');
  buttons.className = 'action-row';
  list.slice(0, 3).forEach((w, i) => {
    const b = document.createElement('button');
    b.className = `action-btn${i === 0 && watchable(ev) ? ' primary' : ''}${w.confidence === 'guess' ? ' guess' : ''}`;
    b.innerHTML = `${i === 0 ? icon('play', true) : ''}<span class="btn-channel">${channelLabel(w.channel, w.foreign)}</span>`;
    b.title = w.confidence === 'guide' ? w.title : 'A guess from the channel name';
    b.addEventListener('click', () => watchEvent(ev, w.streams[0]));
    buttons.appendChild(b);
  });
  if (ev.state === 'pre') buttons.appendChild(reminderButton(ev));
  right.appendChild(buttons);
  box.append(left, right);
}

// ---------- Row, chips, note ----------

function visibleEvents() {
  const events = data ? data.events : [];
  if (filter === 'mine') return events.filter((ev) => ev.tags.includes('your-team') || ev.tags.includes('spanish'));
  if (filter !== 'all') return events.filter((ev) => ev.group === filter);
  return events;
}

function renderChips() {
  const events = data ? data.events : [];
  const chips = [['all', 'All']];
  if (events.some((ev) => ev.tags.includes('your-team') || ev.tags.includes('spanish'))) chips.push(['mine', 'My teams']);
  GROUPS.forEach(([g, label]) => { if (events.some((ev) => ev.group === g)) chips.push([g, label]); });
  if (!chips.some(([g]) => g === filter)) filter = 'all';
  el.chips.innerHTML = '';
  chips.forEach(([g, label]) => {
    const b = document.createElement('button');
    b.className = `pill small${g === filter ? ' active' : ''}`;
    b.textContent = label;
    b.addEventListener('click', () => { filter = g; el.row.scrollLeft = 0; renderSports(); });
    el.chips.appendChild(b);
  });
}

function setNote(text) {
  el.note.textContent = text;
  el.note.hidden = !text;
}

function renderNote() {
  if (failed && !data) return setNote(`Couldn't load the fixtures: ${failed}`);
  if (!data) return setNote('');
  const g = data.guide;
  if (!g.builtAt) return setNote(g.error ? `Couldn't read your provider's guide (${g.error}), so channels are best guesses.` : 'Reading your provider\'s guide… channels are best guesses until it\'s ready.');
  const parts = [];
  if (g.until && data.events.some((ev) => ev.start > g.until)) {
    parts.push(`Your provider's guide runs until ${dayName(g.until)} ${fmtTime(g.until)}; channels for later matches are best guesses.`);
  }
  if (data.errors && data.errors.length) parts.push(`Not loaded: ${data.errors.join(', ')}.`);
  setNote(parts.join(' '));
}

export function renderSports() {
  if (!session.creds) return;
  if (dataKey !== settingsKey() && !loading) {
    load();
    if (!data) {
      el.row.innerHTML = '<div class="loading-msg">Loading matches…</div>';
      el.featured.hidden = true;
      return;
    }
  }
  if (!data) {
    el.featured.hidden = true;
    el.chips.innerHTML = '';
    el.row.innerHTML = loading ? '<div class="loading-msg">Loading matches…</div>' : '';
    renderNote();
    return;
  }
  renderFeatured(data.featured);
  renderChips();
  const scroll = el.row.scrollLeft;
  el.row.innerHTML = '';
  const events = visibleEvents().filter((ev) => !data.featured || ev.id !== data.featured.id || filter !== 'all');
  if (!events.length) el.row.innerHTML = '<div class="empty-msg">No matches in the next 7 days for these competitions.</div>';
  events.forEach((ev) => el.row.appendChild(eventCard(ev)));
  el.row.scrollLeft = scroll;
  renderNote();
}

// ---------- Settings sheet ----------

let sheetChanged = false;

function renderSheet() {
  const s = sportsSettings();
  el.teams.innerHTML = '';
  s.teams.forEach((team) => {
    const chip = document.createElement('span');
    chip.className = 'pill small removable';
    chip.innerHTML = `<span></span><button aria-label="Remove ${escapeHtml(team)}">${icon('close')}</button>`;
    chip.firstChild.textContent = team;
    chip.querySelector('button').addEventListener('click', () => {
      setSportsSettings({ teams: sportsSettings().teams.filter((t) => t !== team) });
      sheetChanged = true;
      renderSheet();
    });
    el.teams.appendChild(chip);
  });
  if (!s.teams.length) el.teams.innerHTML = '<span class="sheet-hint">No teams yet.</span>';

  const catalog = (data && data.leagues) || [];
  const on = new Set(s.leagues || catalog.map((l) => l.id));
  el.leagues.innerHTML = catalog.length ? '' : '<span class="sheet-hint">Loading…</span>';
  catalog.forEach((l) => {
    const label = document.createElement('label');
    label.className = 'checkbox-row';
    label.innerHTML = `<input type="checkbox"${on.has(l.id) ? ' checked' : ''} /> <span></span>`;
    label.lastChild.textContent = l.name;
    label.firstChild.addEventListener('change', (e) => {
      const next = new Set(sportsSettings().leagues || catalog.map((x) => x.id));
      if (e.target.checked) next.add(l.id); else next.delete(l.id);
      setSportsSettings({ leagues: catalog.map((x) => x.id).filter((id) => next.has(id)) });
      sheetChanged = true;
    });
    el.leagues.appendChild(label);
  });
  el.athletes.checked = s.spanishAthletes;
}

function openSheet() {
  sheetChanged = false;
  renderSheet();
  el.sheet.hidden = false;
  el.teamInput.focus();
}

export const sheetOpen = () => !el.sheet.hidden;

export function closeSheet() {
  el.sheet.hidden = true;
  if (sheetChanged) load();
}

export function initSports() {
  el.edit.addEventListener('click', openSheet);
  el.sheetClose.innerHTML = icon('close');
  el.sheetClose.addEventListener('click', closeSheet);
  el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) closeSheet(); });
  el.sheet.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeSheet(); } });
  el.teamForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = el.teamInput.value.trim();
    if (!name) return;
    const teams = sportsSettings().teams;
    if (!teams.some((t) => t.toLowerCase() === name.toLowerCase())) setSportsSettings({ teams: [...teams, name] });
    el.teamInput.value = '';
    sheetChanged = true;
    renderSheet();
  });
  el.athletes.addEventListener('change', () => {
    setSportsSettings({ spanishAthletes: el.athletes.checked });
    sheetChanged = true;
  });
}
