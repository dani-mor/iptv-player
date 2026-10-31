// TV guide: a timeline of programmes per channel for the Live TV browse page.

import { $, escapeHtml, fmtTime, makeActivatable } from './util.js';
import { fillThumb, whenVisible } from './artwork.js';
import { loadEpg, epgListings, epgEntry, epgNeedsFetch, nowProgram, progressPct } from './epg.js';
import { channelTitleHtml, favButton } from './channels.js';
import { openTheater } from './theater.js';

const GUIDE_PX_PER_MIN = 5;
const GUIDE_CH_W = 220;
const GUIDE_HOURS = 12;
const GUIDE_BATCH = 80;

const guideEl = () => $('#guide');
let guideState = null; // { t0, t1, items, rows: Map(streamId -> row) }

const guideX = (ms) => ((ms - guideState.t0) / 60000) * GUIDE_PX_PER_MIN;

export function renderGuide(items, emptyMsg) {
  const guide = guideEl();
  const now = Date.now();
  const t0 = Math.floor(now / 1800e3) * 1800e3 - 1800e3;
  guideState = { t0, t1: t0 + GUIDE_HOURS * 3600e3, items, rows: new Map() };
  guide.innerHTML = '';
  if (!items.length) {
    guide.innerHTML = `<div class="empty-msg">${escapeHtml(emptyMsg)}</div>`;
    return;
  }

  const inner = document.createElement('div');
  inner.className = 'guide-inner';
  inner.style.width = `${GUIDE_CH_W + guideX(guideState.t1)}px`;

  const head = document.createElement('div');
  head.className = 'guide-head';
  head.innerHTML = `<div class="guide-corner">${escapeHtml(new Date(now).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }))}</div>`;
  const times = document.createElement('div');
  times.className = 'guide-times';
  for (let t = t0; t < guideState.t1; t += 1800e3) {
    times.insertAdjacentHTML('beforeend', `<span style="left:${guideX(t)}px">${escapeHtml(fmtTime(t))}</span>`);
  }
  head.appendChild(times);

  const rows = document.createElement('div');
  rows.className = 'guide-rows';
  const nowLine = document.createElement('div');
  nowLine.className = 'guide-now';
  inner.append(head, rows, nowLine);
  guide.appendChild(inner);

  let rendered = 0;
  const appendBatch = () => {
    const frag = document.createDocumentFragment();
    items.slice(rendered, rendered + GUIDE_BATCH).forEach((ch) => frag.appendChild(buildGuideRow(ch, items)));
    rendered = Math.min(items.length, rendered + GUIDE_BATCH);
    rows.appendChild(frag);
    if (rendered < items.length) {
      const sentinel = document.createElement('div');
      sentinel.className = 'guide-sentinel';
      rows.appendChild(sentinel);
      whenVisible(sentinel, () => { sentinel.remove(); appendBatch(); });
    }
  };
  appendBatch();
  positionGuideNow();
  guide.scrollLeft = Math.max(0, guideX(now) - 90);
}

function buildGuideRow(ch, railItems) {
  const row = document.createElement('div');
  row.className = 'guide-row';
  const chCell = document.createElement('div');
  chCell.className = 'guide-ch';
  chCell.title = ch.name || '';
  makeActivatable(chCell);
  const logo = document.createElement('div');
  logo.className = 'ch-logo';
  fillThumb(logo, ch.stream_icon, 'tv');
  const name = document.createElement('span');
  name.className = 'guide-ch-name';
  name.innerHTML = channelTitleHtml(ch.name);
  chCell.append(logo, name, favButton(ch, 'row-fav'));
  chCell.addEventListener('click', () => openTheater(ch, railItems));

  const track = document.createElement('div');
  track.className = 'guide-track';
  track.innerHTML = '<div class="guide-empty"><span class="skeleton skeleton-bar"></span></div>';
  row.append(chCell, track);
  guideState.rows.set(String(ch.stream_id), { row, track, ch, railItems, loaded: false });
  whenVisible(row, () => loadEpg(ch.stream_id, 'full').then(() => {
    const r = guideState && guideState.rows.get(String(ch.stream_id));
    if (r && r.row === row) { r.loaded = true; renderGuideTrack(r); }
  }));
  return row;
}

function renderGuideTrack(r) {
  const { t0, t1 } = guideState;
  const now = Date.now();
  const progs = epgListings(r.ch.stream_id).filter((p) => p.end > t0 && p.start < t1);
  r.track.innerHTML = '';
  if (!progs.length) {
    r.track.innerHTML = '<div class="guide-empty">No guide information</div>';
    return;
  }
  const frag = document.createDocumentFragment();
  progs.forEach((p) => {
    const left = guideX(Math.max(p.start, t0));
    const width = guideX(Math.min(p.end, t1)) - left;
    const b = document.createElement('button');
    const live = p.start <= now && p.end > now;
    b.className = `guide-prog${live ? ' now' : ''}${p.end <= now ? ' past' : ''}`;
    b.style.left = `${left}px`;
    b.style.width = `${Math.max(width - 3, 2)}px`;
    b.dataset.left = left;
    b.dataset.right = left + width;
    b.title = `${fmtTime(p.start)} – ${fmtTime(p.end)}  ${p.title}${p.desc ? `\n\n${p.desc}` : ''}`;
    b.innerHTML = `${live ? `<i class="guide-fill" style="width:${progressPct(p).toFixed(1)}%"></i>` : ''}<span class="guide-prog-title"></span><span class="guide-prog-time">${escapeHtml(fmtTime(p.start))} – ${escapeHtml(fmtTime(p.end))}</span>`;
    b.querySelector('.guide-prog-title').textContent = p.title;
    b.addEventListener('click', () => openTheater(r.ch, r.railItems));
    frag.appendChild(b);
  });
  r.track.appendChild(frag);
  pinGuideTitles(r.track);
}

// Programmes that started before the visible edge would hide their title under the
// sticky channel column; nudge the text so it stays readable while scrolling.
function pinGuideTitles(scope) {
  const edge = guideEl().scrollLeft;
  scope.querySelectorAll('.guide-prog').forEach((b) => {
    const left = Number(b.dataset.left);
    const shift = edge > left ? Math.min(edge - left, Number(b.dataset.right) - left - 80) : 0;
    const pad = `${10 + Math.max(0, shift)}px`;
    if (b.style.paddingLeft !== pad) b.style.paddingLeft = pad;
  });
}

let guideScrollFrame = 0;
export function initGuide() {
  guideEl().addEventListener('scroll', () => {
    if (guideScrollFrame) return;
    guideScrollFrame = requestAnimationFrame(() => {
      guideScrollFrame = 0;
      pinGuideTitles(guideEl());
    });
  }, { passive: true });
}

function positionGuideNow() {
  const line = guideEl().querySelector('.guide-now');
  if (line && guideState) line.style.left = `${GUIDE_CH_W + guideX(Date.now())}px`;
}

// Returns false when the timeline has run out and the guide needs a full re-render.
export function refreshGuide() {
  if (!guideState) return true;
  if (Date.now() > guideState.t1 - 3600e3) return false;
  positionGuideNow();
  guideState.rows.forEach((r) => {
    if (!r.loaded) return;
    if (epgNeedsFetch(epgEntry(r.ch.stream_id, 'full')) && !nowProgram(r.ch.stream_id)) {
      loadEpg(r.ch.stream_id, 'full').then(() => renderGuideTrack(r));
    } else {
      renderGuideTrack(r);
    }
  });
  return true;
}

export const clearGuide = () => { guideState = null; guideEl().innerHTML = ''; };
