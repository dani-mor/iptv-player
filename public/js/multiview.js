// Multiview: up to four live channels at once (limited by the subscription's
// max_connections), one of them with sound.

import { $, icon, debounce, toast } from './util.js';
import { fold, matchesQuery } from './names.js';
import { session } from './api.js';
import { pushView, registerView, onViewChange, TAB_LABELS } from './views.js';
import { library, savedVolume } from './library.js';
import { livePool, versionsOf, loadAll } from './catalog.js';
import { channelTitleHtml, channelRow, renderBatched } from './channels.js';
import { createLivePlayer } from './live-player.js';
import { openTheater } from './theater.js';
import { toggleFullscreen } from './watch.js';

const el = {
  view: $('#multiview-view'),
  grid: $('#mv-grid'),
  picker: $('#picker'),
  pickerSearch: $('#picker-search'),
  pickerList: $('#picker-list'),
  pickerClose: $('#picker-close'),
};

let tiles = []; // { item, node, video, player, tried }
let audioTile = null;
let pool = [];
let pickerRows = null;

const maxTiles = () => {
  const m = Number(session.userInfo && session.userInfo.max_connections);
  return Math.max(1, Math.min(4, m > 0 ? m : 4));
};

export function openMultiview(items, channels) {
  pool = channels && channels.length ? channels : livePool();
  pushView('multiview', TAB_LABELS.live); // stops the theater player first, freeing its connection
  items.slice(0, maxTiles()).forEach(addTile);
  renderLayout();
  if (!tiles.length) openPicker();
}

function tileButton(cls, iconName, title, onClick) {
  const b = document.createElement('button');
  b.className = `icon-btn mv-btn ${cls}`;
  b.innerHTML = icon(iconName);
  b.title = title;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function addTile(item) {
  if (tiles.length >= maxTiles()) {
    toast(`Your subscription allows ${maxTiles()} streams at once.`);
    return;
  }
  const node = document.createElement('div');
  node.className = 'mv-tile buffering';
  node.innerHTML = '<video playsinline></video><div class="mv-spinner"></div><div class="mv-bar"><div class="mv-name"></div><div class="mv-actions"></div></div><div class="mv-msg" hidden></div>';
  const video = node.querySelector('video');
  video.muted = true;
  const tile = { item, node, video, tried: new Set() };
  tile.player = createLivePlayer(video, { onGiveUp: (kind, it) => tileGiveUp(tile, kind, it) });

  const actions = node.querySelector('.mv-actions');
  tile.audioBtn = tileButton('mv-audio', 'mute', 'Listen to this one', () => setAudio(tile));
  actions.append(
    tile.audioBtn,
    tileButton('', 'expand', 'Watch this one full size', () => openTheater(tile.item, pool)),
    tileButton('', 'fullscreen', 'Full screen', () => toggleFullscreen(node)),
    tileButton('', 'close', 'Remove', () => removeTile(tile)),
  );
  node.addEventListener('click', (e) => { if (!e.target.closest('button')) setAudio(tile); });
  node.addEventListener('dblclick', (e) => { if (!e.target.closest('button')) toggleFullscreen(node); });
  video.addEventListener('waiting', () => node.classList.add('buffering'));
  video.addEventListener('playing', () => node.classList.remove('buffering'));

  tiles.push(tile);
  el.grid.appendChild(node);
  playTile(tile, item);
  if (!audioTile) setAudio(tile);
}

function playTile(tile, item) {
  tile.item = item;
  tile.tried.add(String(item.stream_id));
  tile.node.querySelector('.mv-name').innerHTML = channelTitleHtml(item.name);
  tile.node.querySelector('.mv-name').title = item.name || '';
  tile.node.querySelector('.mv-msg').hidden = true;
  tile.node.classList.add('buffering');
  tile.player.play(item);
}

function tileGiveUp(tile, kind, item) {
  const next = versionsOf(item).find((v) => !tile.tried.has(String(v.stream_id)));
  if (next) {
    setTimeout(() => { if (tiles.includes(tile) && tile.player.item === item) playTile(tile, next); }, 0);
    return;
  }
  tile.node.classList.remove('buffering');
  const msg = tile.node.querySelector('.mv-msg');
  msg.innerHTML = '';
  msg.append(Object.assign(document.createElement('span'), {
    textContent: { desync: 'Out of sync at the provider', unsupported: "This format can't play here", lost: 'Connection lost' }[kind],
  }));
  const retry = document.createElement('button');
  retry.className = 'action-btn';
  retry.textContent = 'Retry';
  retry.addEventListener('click', (e) => {
    e.stopPropagation();
    msg.hidden = true;
    tile.tried = new Set();
    playTile(tile, tile.item);
  });
  msg.appendChild(retry);
  msg.hidden = false;
}

function setAudio(tile) {
  if (!tile) return;
  audioTile = tile;
  const vol = savedVolume();
  tiles.forEach((t) => {
    const on = t === tile;
    if (on) t.video.volume = Number(vol.volume) > 0 ? Number(vol.volume) : 1;
    t.video.muted = !on;
    t.node.classList.toggle('has-audio', on);
    t.audioBtn.innerHTML = icon(on ? 'volume' : 'mute');
    t.audioBtn.title = on ? 'Playing this one’s sound' : 'Listen to this one';
  });
}

export function setAudioIndex(i) {
  if (tiles[i]) setAudio(tiles[i]);
}

function removeTile(tile) {
  tile.player.close();
  tile.node.remove();
  tiles = tiles.filter((t) => t !== tile);
  if (audioTile === tile) {
    audioTile = null;
    setAudio(tiles[0]);
  }
  renderLayout();
}

function renderLayout() {
  let add = el.grid.querySelector('.mv-add');
  if (tiles.length < maxTiles()) {
    if (!add) {
      add = document.createElement('button');
      add.className = 'mv-add';
      add.innerHTML = `${icon('plus')}<span>Add a channel</span>`;
      add.addEventListener('click', openPicker);
    }
    el.grid.appendChild(add); // always last
  } else if (add) {
    add.remove();
  }
  const total = tiles.length + (tiles.length < maxTiles() ? 1 : 0);
  const cols = total <= 1 ? 1 : 2;
  el.grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
  el.grid.style.gridTemplateRows = `repeat(${Math.ceil(total / cols)}, minmax(0, 1fr))`;
}

function closeMultiview() {
  tiles.forEach((t) => t.player.close());
  tiles = [];
  audioTile = null;
  el.grid.innerHTML = '';
  closePicker();
}

// ---------- Channel picker ----------

export const pickerOpen = () => !el.picker.hidden;

export function openPicker() {
  el.picker.hidden = false;
  el.pickerSearch.value = '';
  renderPicker();
  el.pickerSearch.focus();
  loadAll('live').then(() => { if (pickerOpen() && el.pickerSearch.value.trim()) renderPicker(); }).catch(() => {});
}

export function closePicker() {
  el.picker.hidden = true;
  if (pickerRows) pickerRows.disconnect();
  el.pickerList.innerHTML = '';
}

function renderPicker() {
  const q = fold(el.pickerSearch.value.trim());
  const playing = new Set(tiles.map((t) => String(t.item.stream_id)));
  let items;
  if (q) {
    items = livePool().filter((c) => matchesQuery(c, q));
  } else {
    const favIds = new Set(library.favs.map((f) => String(f.stream_id)));
    items = [...library.favs, ...pool.filter((c) => !favIds.has(String(c.stream_id)))];
  }
  items = items.filter((c) => !playing.has(String(c.stream_id)));
  if (pickerRows) pickerRows.disconnect();
  if (!items.length) {
    el.pickerList.innerHTML = `<div class="empty-msg">${q ? 'No matching channels' : 'No channels'}</div>`;
    return;
  }
  pickerRows = renderBatched(el.pickerList, items, (ch) => channelRow(ch, {
    fav: false,
    onClick: (c) => {
      closePicker();
      addTile(c);
      renderLayout();
    },
  }), { batch: 60 });
}

export function initMultiview() {
  registerView('multiview', el.view, () => tiles.length > 0);
  onViewChange((prev, next) => { if (prev === 'multiview' && next !== 'multiview') closeMultiview(); });
  el.pickerSearch.addEventListener('input', debounce(renderPicker, 120));
  el.pickerClose.innerHTML = icon('close');
  el.pickerClose.addEventListener('click', closePicker);
  el.picker.addEventListener('click', (e) => { if (e.target === el.picker) closePicker(); });
}
