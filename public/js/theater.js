// Live TV theater: big player, now / next info, channel rail, other versions of the
// channel (with automatic fail-over), zapping, and a mini player while browsing.

import { $, icon, escapeHtml, fmtTime, fmtDuration, debounce, toast } from './util.js';
import { fold, matchesQuery, parseChannelName, versionLabels } from './names.js';
import { pushView, registerView, onViewChange, nav, TAB_LABELS } from './views.js';
import { isFav, toggleFav, addRecent, bindVolume } from './library.js';
import { livePool, versionsOf, loadAll } from './catalog.js';
import { loadEpg, epgListings, nowProgram, progressPct } from './epg.js';
import { channelTitleHtml, channelRow, paintFavButton, renderBatched } from './channels.js';
import { createLivePlayer } from './live-player.js';
import { openMultiview } from './multiview.js';

const SCHEDULE_PREVIEW = 6;

const el = {
  view: $('#theater-view'),
  col: $('#theater-view .theater-player-col'),
  wrap: $('#theater-video-wrap'),
  video: $('#theater-video'),
  osd: $('#theater-osd'),
  name: $('#theater-channel-name'),
  versions: $('#theater-versions'),
  lastBtn: $('#theater-last-btn'),
  liveBtn: $('#theater-live-btn'),
  liveLabel: $('#theater-live-btn .live-label'),
  pipBtn: $('#theater-pip-btn'),
  multiBtn: $('#theater-multi-btn'),
  favBtn: $('#theater-fav-btn'),
  muteBtn: $('#theater-mute-btn'),
  volume: $('#theater-volume'),
  epg: $('#theater-epg'),
  schedule: $('#theater-schedule'),
  search: $('#theater-search'),
  list: $('#theater-channel-list'),
  mini: $('#mini-player'),
  miniSlot: $('#mini-slot'),
  miniName: $('#mini-name'),
  miniExpand: $('#mini-expand'),
  miniClose: $('#mini-close'),
};

const player = createLivePlayer(el.video, { onGiveUp: handleGiveUp, onChange: updateLiveButton });
let railItems = []; // the list the theater was opened from
let railShown = []; // railItems after the rail's filter
let railList = null;
let activeId = null;
let prevChannel = null;
let failover = null; // { tried: Set(streamId) } for the channel the user picked
let mini = false;
let osdTimer = null;

export const theaterVideo = () => el.video;
export const liveItem = () => player.item;

export function openTheater(item, items) {
  railItems = items && items.length ? items : livePool();
  el.search.value = '';
  pushView('theater', TAB_LABELS.live);
  renderRail(railItems);
  playChannel(item);
  // The full channel list lets us find other versions of a channel in any category.
  loadAll('live').then(() => { if (player.item) renderVersions(); }).catch(() => {});
}

export function closeTheater() {
  exitMini();
  if (document.pictureInPictureElement === el.video) document.exitPictureInPicture().catch(() => {});
  player.close();
  activeId = null;
  failover = null;
}

export function playChannel(item, { auto = false } = {}) {
  const current = player.item;
  if (!auto && current && String(current.stream_id) !== String(item.stream_id)) prevChannel = current;
  if (!auto || !failover) failover = { tried: new Set() };
  failover.tried.add(String(item.stream_id));

  activeId = item.stream_id;
  highlightActiveRow('center');
  el.name.innerHTML = channelTitleHtml(item.name);
  el.name.title = item.name || '';
  el.miniName.innerHTML = channelTitleHtml(item.name);
  el.col.scrollTop = 0;

  player.play(item);
  addRecent(item);
  paintFavButton(el.favBtn, isFav(item.stream_id));
  updateMuteUI();
  updateLastButton();
  renderVersions();
  renderTheaterEpg(item.stream_id);
  showOsd(item);
}

// The channel can't play: try the next version of it that we haven't tried yet.
function handleGiveUp(kind, item, detail) {
  if (!item) return;
  const name = parseChannelName(item.name).title;
  const reason = {
    desync: `${name}: audio and video are out of sync at the provider.`,
    unsupported: `${name} uses a video format your browser can't play.`,
    lost: `Lost connection to ${name}${detail ? ` (${detail})` : ''}.`,
  }[kind];
  const versions = versionsOf(item);
  const next = failover && versions.find((v) => !failover.tried.has(String(v.stream_id)));
  if (next) {
    const label = versionLabels(versions)[versions.indexOf(next)];
    toast(`${reason} Switched to the ${label} version.`, { duration: 6000 });
    setTimeout(() => { if (player.item === item) playChannel(next, { auto: true }); }, 0);
    return;
  }
  if (kind === 'lost') toast(`${reason} Press Go live to retry.`, { duration: 6000 });
  else toast(`${reason} ${versions.length > 1 ? "The other versions didn't work either." : 'Try another channel.'}`, { duration: 6000 });
}

function renderVersions() {
  const item = player.item;
  el.versions.innerHTML = '';
  const versions = item ? versionsOf(item) : [];
  el.versions.hidden = versions.length < 2;
  if (versions.length < 2) return;
  const labels = versionLabels(versions);
  el.versions.insertAdjacentHTML('beforeend', '<span class="versions-label">Versions</span>');
  versions.forEach((v, i) => {
    const b = document.createElement('button');
    const active = String(v.stream_id) === String(item.stream_id);
    b.className = `pill${active ? ' active' : ''}`;
    b.textContent = labels[i];
    b.title = v.name || '';
    b.addEventListener('click', () => { if (!active) playChannel(v); });
    el.versions.appendChild(b);
  });
}

// ---------- Zapping ----------

export function zap(offset) {
  const list = railShown.length ? railShown : railItems;
  if (!list.length) return;
  const idx = list.findIndex((c) => String(c.stream_id) === String(activeId));
  playChannel(list[idx < 0 ? 0 : (idx + offset + list.length) % list.length]);
}

// The channel before this one, unless fail-over already landed back on it.
const previous = () => (prevChannel && String(prevChannel.stream_id) !== String(activeId) ? prevChannel : null);

export function lastChannel() {
  if (previous()) playChannel(previous());
}

function updateLastButton() {
  const prev = previous();
  el.lastBtn.hidden = !prev;
  if (prev) el.lastBtn.title = `Back to ${parseChannelName(prev.name).title} (Backspace)`;
}

// Channel name and what's on, over the video for a few seconds after switching.
function showOsd(item) {
  const p = nowProgram(item.stream_id);
  el.osd.innerHTML = `<div class="osd-name">${channelTitleHtml(item.name)}</div><div class="osd-now">${p ? escapeHtml(p.title) : ''}</div>`;
  el.osd.classList.add('show');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => el.osd.classList.remove('show'), 3500);
}

// ---------- Channel rail ----------

function renderRail(items) {
  railShown = items;
  if (railList) railList.disconnect();
  railList = renderBatched(el.list, items, (ch) => channelRow(ch, { onClick: (c) => playChannel(c) }), { batch: 80 });
  highlightActiveRow('center');
}

function highlightActiveRow(scrollBlock) {
  const idx = railShown.findIndex((c) => String(c.stream_id) === String(activeId));
  if (idx >= 0 && railList) railList.ensure(idx);
  let activeRow = null;
  el.list.querySelectorAll('.channel-row').forEach((row) => {
    const on = row.dataset.streamId === String(activeId);
    row.classList.toggle('active', on);
    if (on) activeRow = row;
  });
  if (scrollBlock && activeRow && nav.view === 'theater') activeRow.scrollIntoView({ block: scrollBlock });
}

// ---------- Live button, volume ----------

function updateLiveButton() {
  const atLive = player.isAtLive();
  el.liveBtn.classList.toggle('at-live', atLive);
  const label = atLive ? 'LIVE' : 'Go live';
  if (el.liveLabel.textContent !== label) el.liveLabel.textContent = label;
  el.liveBtn.title = atLive ? 'Watching live' : 'Jump to live';
}

function updateMuteUI() {
  const v = el.video;
  const isMuted = v.muted || v.volume === 0;
  el.muteBtn.innerHTML = icon(isMuted ? 'mute' : 'volume');
  el.muteBtn.title = isMuted ? 'Unmute (M)' : 'Mute (M)';
  el.volume.value = isMuted ? 0 : v.volume;
}

export function toggleMute() {
  const v = el.video;
  v.muted = !v.muted;
  if (!v.muted && v.volume === 0) v.volume = 1;
}

// ---------- Mini player ----------

function enterMini() {
  if (mini || !player.item) return;
  mini = true;
  el.miniSlot.appendChild(el.wrap); // moved in one task, so playback carries on
  el.mini.hidden = false;
}

function exitMini() {
  if (!mini) return;
  mini = false;
  el.col.prepend(el.wrap);
  el.mini.hidden = true;
}

// ---------- EPG under the player ----------

let theaterEpgKey = '';

function renderTheaterEpg(streamId) {
  theaterEpgKey = '';
  el.epg.innerHTML = '';
  el.schedule.hidden = true;
  const draw = () => {
    if (streamId !== activeId) return;
    updateTheaterEpg(true);
    const now = el.osd.querySelector('.osd-now');
    const p = nowProgram(streamId);
    if (now && !now.textContent && p) now.textContent = p.title;
  };
  draw();
  loadEpg(streamId, 'short', true).then(draw);
  loadEpg(streamId, 'full', true).then(draw);
}

function dayLabel(ms) {
  const d = new Date(ms);
  const today = new Date();
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
  return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
}

function updateTheaterEpg(force) {
  const streamId = activeId;
  const now = Date.now();
  const listings = epgListings(streamId).filter((l) => l.end > now);
  const current = listings[0] && listings[0].start <= now ? listings[0] : null;
  const key = `${streamId}:${listings.length}:${current ? current.start : ''}`;

  if (!force && key === theaterEpgKey) {
    // Same programme: just move the progress bar along.
    const fill = el.epg.querySelector('.now-bar i');
    const left = el.epg.querySelector('.now-left');
    if (current && fill) fill.style.width = `${progressPct(current).toFixed(1)}%`;
    if (current && left) left.textContent = `${fmtDuration((current.end - now) / 1000)} left`;
    return;
  }
  theaterEpgKey = key;

  el.epg.innerHTML = '';
  if (!listings.length) {
    el.schedule.hidden = true;
    return;
  }

  if (current) {
    const card = document.createElement('div');
    card.className = 'now-card';
    card.innerHTML = `
      <div class="now-label"><span class="now-pill">NOW</span>${escapeHtml(fmtTime(current.start))} – ${escapeHtml(fmtTime(current.end))}</div>
      <div class="now-title"></div>
      <div class="now-progress"><div class="now-bar"><i style="width:${progressPct(current).toFixed(1)}%"></i></div><span class="now-left">${escapeHtml(fmtDuration((current.end - now) / 1000))} left</span></div>
      <p class="now-desc"></p>`;
    card.querySelector('.now-title').textContent = current.title;
    const desc = card.querySelector('.now-desc');
    desc.textContent = current.desc;
    desc.title = 'Show more';
    desc.addEventListener('click', () => desc.classList.toggle('open'));
    el.epg.appendChild(card);
  }

  const upcoming = listings.filter((l) => l !== current && l.start < now + 24 * 3600e3).slice(0, 40);
  el.schedule.innerHTML = '';
  el.schedule.hidden = !upcoming.length;
  if (!upcoming.length) return;
  el.schedule.insertAdjacentHTML('beforeend', '<h3 class="section-title">Up Next</h3>');
  let lastDay = dayLabel(now);
  upcoming.forEach((p, i) => {
    const day = dayLabel(p.start);
    if (day !== lastDay) {
      el.schedule.insertAdjacentHTML('beforeend', `<div class="schedule-day">${escapeHtml(day)}</div>`);
      lastDay = day;
    }
    const row = document.createElement('div');
    row.className = 'schedule-row';
    row.innerHTML = `<span class="schedule-time">${escapeHtml(fmtTime(p.start))}</span><div class="schedule-text"><div class="schedule-title"></div>${p.desc ? '<div class="schedule-desc"></div>' : ''}</div>`;
    row.querySelector('.schedule-title').textContent = p.title;
    if (p.desc) {
      row.querySelector('.schedule-desc').textContent = p.desc;
      row.classList.add('expandable');
      row.addEventListener('click', () => row.classList.toggle('open'));
    }
    if (i >= SCHEDULE_PREVIEW) row.hidden = true;
    el.schedule.appendChild(row);
  });
  // Hide day headers whose rows are all collapsed, and offer the rest on demand.
  const syncDays = () => el.schedule.querySelectorAll('.schedule-day').forEach((d) => {
    const next = d.nextElementSibling;
    d.hidden = !next || next.hidden;
  });
  syncDays();
  if (upcoming.length > SCHEDULE_PREVIEW) {
    const more = document.createElement('button');
    more.className = 'schedule-more';
    more.textContent = 'Show full schedule';
    more.addEventListener('click', () => {
      el.schedule.querySelectorAll('.schedule-row[hidden]').forEach((r) => { r.hidden = false; });
      syncDays();
      more.remove();
    });
    el.schedule.appendChild(more);
  }
}

export function tickTheater() {
  if (nav.view === 'theater' && player.item) updateTheaterEpg();
}

export function refreshTheaterFav() {
  if (player.item) paintFavButton(el.favBtn, isFav(player.item.stream_id));
}

export const focusTheaterSearch = () => { el.search.focus(); el.search.select(); };

export function initTheater() {
  registerView('theater', el.view, () => !!player.item);
  // Leaving for a page without its own player keeps the channel going in a corner;
  // movies, episodes and multiview need the connection, so live stops for those.
  onViewChange((prev, next) => {
    if (!player.item) return;
    if (next === 'theater') { exitMini(); return; }
    const browsing = next === 'browse' || next === 'series' || next === 'movie';
    if (browsing && mini) return;
    if (browsing && prev === 'theater' && !player.stopped) { enterMini(); return; }
    closeTheater();
  });

  bindVolume(el.video);
  el.video.addEventListener('volumechange', updateMuteUI);
  ['play', 'pause', 'seeked'].forEach((evt) => el.video.addEventListener(evt, updateLiveButton));
  updateMuteUI();

  el.liveBtn.addEventListener('click', () => player.goLive());
  el.lastBtn.innerHTML = icon('swap');
  el.lastBtn.addEventListener('click', lastChannel);
  el.favBtn.addEventListener('click', () => { if (player.item) toggleFav(player.item); });
  el.muteBtn.addEventListener('click', toggleMute);
  el.volume.addEventListener('input', () => {
    const v = el.video;
    v.volume = parseFloat(el.volume.value);
    v.muted = v.volume === 0;
  });

  el.pipBtn.innerHTML = icon('pip');
  el.pipBtn.hidden = !document.pictureInPictureEnabled;
  el.pipBtn.addEventListener('click', () => {
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    else el.video.requestPictureInPicture().catch(() => {});
  });

  el.multiBtn.innerHTML = icon('multiview');
  el.multiBtn.addEventListener('click', () => {
    const item = player.item;
    if (item) openMultiview([item], railItems);
  });

  el.search.addEventListener('input', debounce(() => {
    const q = fold(el.search.value.trim());
    renderRail(q ? railItems.filter((it) => matchesQuery(it, q)) : railItems);
  }, 100));

  el.miniExpand.innerHTML = icon('expand');
  el.miniClose.innerHTML = icon('close');
  el.miniExpand.addEventListener('click', () => pushView('theater', TAB_LABELS.live));
  el.miniClose.addEventListener('click', closeTheater);
}
