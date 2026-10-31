// Channel UI pieces shared by the grid, guide, theater rail, multiview and picker.

import { escapeHtml, icon, makeActivatable } from './util.js';
import { parseChannelName } from './names.js';
import { fillThumb } from './artwork.js';
import { isFav, toggleFav } from './library.js';
import { watchEpg } from './epg.js';

export const badgesHtml = (tags) => tags.map((t) => `<span class="q-badge">${escapeHtml(t)}</span>`).join('');

// Clean title followed by quality badges; the full provider name stays in the tooltip.
export function channelTitleHtml(name) {
  const { title, tags } = parseChannelName(name || 'Untitled');
  return `<span class="ch-title-text">${escapeHtml(title)}</span>${badgesHtml(tags)}`;
}

export function paintFavButton(btn, on) {
  btn.classList.toggle('is-fav', on);
  btn.innerHTML = icon('star', on);
  btn.title = on ? 'Remove from favourites' : 'Add to favourites';
  btn.setAttribute('aria-pressed', String(on));
}

export function favButton(ch, className) {
  const btn = document.createElement('button');
  btn.className = className;
  btn.dataset.favId = ch.stream_id;
  paintFavButton(btn, isFav(ch.stream_id));
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleFav(ch);
  });
  return btn;
}

export function refreshFavButtons() {
  document.querySelectorAll('[data-fav-id]').forEach((b) => paintFavButton(b, isFav(b.dataset.favId)));
}

// A list row: logo, name + badges, what's on now, optional favourite star.
export function channelRow(ch, { onClick, fav = true } = {}) {
  const row = document.createElement('div');
  row.className = 'channel-row';
  row.dataset.streamId = ch.stream_id;
  row.title = ch.name || '';
  makeActivatable(row);

  const logo = document.createElement('div');
  logo.className = 'ch-logo';
  fillThumb(logo, ch.stream_icon, 'tv');

  const text = document.createElement('div');
  text.className = 'ch-text';
  text.innerHTML = `<div class="ch-name">${channelTitleHtml(ch.name)}</div><div class="ch-now epg-title"></div><div class="ch-bar epg-bar" hidden><i></i></div>`;

  row.append(logo, text);
  if (fav) row.appendChild(favButton(ch, 'row-fav'));
  watchEpg(row, ch.stream_id);
  row.addEventListener('click', () => onClick(ch));
  return row;
}

// Renders a long list in batches as it scrolls into view. Returns { ensure(index) } to
// make sure a given row exists (e.g. to scroll the playing channel into view).
export function renderBatched(container, items, buildRow, { batch = 100, root = container } = {}) {
  container.innerHTML = '';
  let rendered = 0;
  const sentinel = document.createElement('div');
  sentinel.className = 'list-sentinel';
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) appendBatch();
  }, { root, rootMargin: '600px' });

  function appendBatch(upTo = rendered + batch) {
    const frag = document.createDocumentFragment();
    const end = Math.min(items.length, Math.max(upTo, rendered + batch));
    for (let i = rendered; i < end; i++) frag.appendChild(buildRow(items[i], i));
    rendered = end;
    container.insertBefore(frag, sentinel);
    if (rendered >= items.length) {
      observer.disconnect();
      sentinel.remove();
    }
  }

  container.appendChild(sentinel);
  appendBatch();
  if (rendered < items.length) observer.observe(sentinel);
  return {
    ensure(index) { if (index >= rendered && rendered < items.length) appendBatch(index + 1); },
    disconnect() { observer.disconnect(); },
  };
}
