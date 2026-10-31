// Browse page: category sidebar, the grid of channels / movies / shows, search,
// the Favourites / Continue Watching shelf, and the Channels / Guide switch.

import { $, icon, escapeHtml, fmtDuration, store, debounce, makeActivatable, skeletonCards, toast } from './util.js';
import { fold, matchesQuery } from './names.js';
import { nav, TAB_LABELS } from './views.js';
import { getCategories, getStreams, loadAll, allLoaded } from './catalog.js';
import { library, isCatHidden, setCatHidden, continueEntries, removeContinue } from './library.js';
import { fillThumb, posterFallback, episodeFallback } from './artwork.js';
import { watchEpg } from './epg.js';
import { channelTitleHtml, favButton } from './channels.js';
import { renderGuide, refreshGuide, clearGuide } from './guide.js';
import { openTheater } from './theater.js';
import { openMovie } from './movie.js';
import { openSeries, getSeriesInfo, flatEpisodes, entrySeries } from './series.js';
import { playMovie, openEpisode } from './watch.js';

const LAST_TAB_KEY = 'iptv_last_tab';
const LIVE_MODE_KEY = 'iptv_live_mode';
const BATCH_SIZE = 120;
const ALL_LABELS = { live: 'All Channels', vod: 'All Movies', series: 'All Shows' };
const EMPTY = {
  favs: 'No favourites yet. Tap the star on any channel to add it here.',
  recent: 'Channels you watch will show up here.',
};

const el = {
  tabs: document.querySelectorAll('#tabs .tab-btn'),
  searchBox: $('#search-box'),
  catFilter: $('#cat-filter'),
  categoryList: $('#category-items'),
  contentArea: $('#content-area'),
  shelf: $('#shelf'),
  shelfTitle: $('#shelf-title'),
  shelfRow: $('#shelf-row'),
  gridTitle: $('#grid-title'),
  contentGrid: $('#content-grid'),
  liveMode: $('#live-mode'),
  guide: $('#guide'),
};

const state = {
  categoryId: null,
  categoryName: '',
  cats: [],
  displayed: [],
  showHidden: false,
  liveMode: store.getRaw(LIVE_MODE_KEY) === 'guide' ? 'guide' : 'grid',
};
let gridObserver = null;

export const lastTab = () => {
  const t = store.getRaw(LAST_TAB_KEY);
  return TAB_LABELS[t] ? t : 'live';
};

const isGuide = () => nav.type === 'live' && state.liveMode === 'guide';

// ---------- Tabs / categories ----------

export function switchTab(type) {
  el.tabs.forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  nav.type = type;
  store.setRaw(LAST_TAB_KEY, type);
  el.searchBox.value = '';
  el.catFilter.value = '';
  state.showHidden = false;
  applyLiveMode();
  loadCategories(type);
}

function showGridSkeleton(type) {
  if (gridObserver) { gridObserver.disconnect(); gridObserver = null; }
  if (isGuide()) {
    el.guide.innerHTML = '<div class="loading-msg">Loading…</div>';
    return;
  }
  el.contentGrid.classList.toggle('aspect-wide', type === 'live');
  el.contentGrid.innerHTML = '';
  el.contentGrid.appendChild(skeletonCards(type === 'live' ? 12 : 18, type === 'live'));
}

async function loadCategories(type) {
  state.categoryId = null;
  el.categoryList.innerHTML = Array.from({ length: 10 }, () => '<div class="category-item skeleton-row"><span class="skeleton skeleton-line"></span></div>').join('');
  el.gridTitle.textContent = '';
  showGridSkeleton(type);
  renderShelf();
  try {
    const cats = await getCategories(type, (fresh) => {
      if (nav.type === type) renderCategoryList(type, fresh);
    });
    if (type !== nav.type) return;
    renderCategoryList(type, cats);
    if (type === 'live' && library.favs.length) {
      selectCategory(type, 'favs', 'Favourites');
    } else {
      const first = cats.find((c) => !isCatHidden(type, c.category_id));
      if (first) selectCategory(type, first.category_id, first.category_name);
      else loadAllForType(type);
    }
  } catch (err) {
    el.categoryList.innerHTML = '<div class="loading-msg">Failed to load categories</div>';
    setBrowseMessage('Failed to load items');
    toast(err.message);
  }
}

function categoryItem(id, name, { iconName, hide, onClick }) {
  const item = document.createElement('div');
  item.className = 'category-item';
  item.dataset.categoryId = id;
  item.title = name;
  makeActivatable(item);
  item.innerHTML = `${iconName ? icon(iconName, iconName === 'star') : ''}<span class="cat-name">${escapeHtml(name)}</span>`;
  if (hide) {
    const btn = document.createElement('button');
    btn.className = 'cat-hide';
    btn.innerHTML = icon(hide === 'hide' ? 'eyeOff' : 'eye');
    btn.title = hide === 'hide' ? 'Hide this category' : 'Show this category again';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleCategoryHidden(id, name, hide === 'hide');
    });
    item.appendChild(btn);
  }
  item.addEventListener('click', onClick);
  return item;
}

function toggleCategoryHidden(id, name, hidden) {
  const type = nav.type;
  setCatHidden(type, id, hidden);
  renderCategoryList();
  if (state.categoryId === 'all') loadAllForType(type);
  if (hidden) toast(`Hid “${name}”`, { label: 'Undo', duration: 8000, run: () => toggleCategoryHidden(id, name, false) });
}

function renderCategoryList(type = nav.type, cats = state.cats) {
  state.cats = cats;
  const q = fold(el.catFilter.value.trim());
  const matches = (c) => !q || fold(c.category_name).includes(q);
  el.categoryList.innerHTML = '';
  const add = (node) => el.categoryList.appendChild(node);

  if (!q) {
    if (type === 'live') {
      const fav = categoryItem('favs', 'Favourites', { iconName: 'star', onClick: () => selectCategory(type, 'favs', 'Favourites') });
      fav.insertAdjacentHTML('beforeend', '<span class="count"></span>');
      add(fav);
      add(categoryItem('recent', 'Recently Watched', { iconName: 'clock', onClick: () => selectCategory(type, 'recent', 'Recently Watched') }));
    }
    add(categoryItem('all', ALL_LABELS[type], { iconName: 'grid', onClick: () => loadAllForType(type) }));
  }

  const heading = document.createElement('div');
  heading.className = 'category-heading';
  heading.textContent = 'Categories';
  add(heading);

  const visible = cats.filter((c) => !isCatHidden(type, c.category_id) && matches(c));
  visible.forEach((c) => add(categoryItem(c.category_id, c.category_name, {
    hide: 'hide', onClick: () => selectCategory(type, c.category_id, c.category_name),
  })));
  if (!visible.length) add(Object.assign(document.createElement('div'), { className: 'category-empty', textContent: q ? 'No matching categories' : 'All categories are hidden' }));

  const hidden = cats.filter((c) => isCatHidden(type, c.category_id) && matches(c));
  if (hidden.length) {
    const toggle = document.createElement('button');
    toggle.className = `category-toggle${state.showHidden ? ' open' : ''}`;
    toggle.innerHTML = `<span>Hidden (${hidden.length})</span>${icon('chevronDown')}`;
    toggle.addEventListener('click', () => { state.showHidden = !state.showHidden; renderCategoryList(); });
    add(toggle);
    if (state.showHidden) {
      hidden.forEach((c) => {
        const item = categoryItem(c.category_id, c.category_name, {
          hide: 'unhide', onClick: () => selectCategory(type, c.category_id, c.category_name),
        });
        item.classList.add('is-hidden');
        add(item);
      });
    }
  }
  updateFavCount();
  markActiveCategory(state.categoryId);
}

function updateFavCount() {
  const count = el.categoryList.querySelector('[data-category-id="favs"] .count');
  if (count) count.textContent = library.favs.length || '';
}

function markActiveCategory(categoryId) {
  el.categoryList.querySelectorAll('.category-item').forEach((n) => {
    n.classList.toggle('active', n.dataset.categoryId === String(categoryId));
  });
}

function setBrowseMessage(msg) {
  if (gridObserver) { gridObserver.disconnect(); gridObserver = null; }
  const target = isGuide() ? el.guide : el.contentGrid;
  target.innerHTML = `<div class="loading-msg">${escapeHtml(msg)}</div>`;
}

function setCategoryHeader(id, name) {
  state.categoryId = id;
  state.categoryName = name;
  markActiveCategory(id);
  el.gridTitle.textContent = name || '';
  el.searchBox.placeholder = `Search ${name || ''}`.trim();
  el.contentArea.scrollTop = 0;
}

async function selectCategory(type, categoryId, categoryName) {
  setCategoryHeader(categoryId, categoryName);
  renderShelf();
  if (categoryId === 'favs' || categoryId === 'recent') {
    state.displayed = (categoryId === 'favs' ? library.favs : library.recents).slice();
    applyFilterAndRender();
    return;
  }
  showGridSkeleton(type);
  try {
    const items = await getStreams(type, categoryId, (fresh) => {
      // The provider's list changed since we cached it: update in place unless the
      // user has already scrolled or searched.
      if (state.categoryId !== categoryId || nav.type !== type || el.searchBox.value.trim() || el.contentArea.scrollTop > 200) return;
      state.displayed = fresh;
      applyFilterAndRender();
    });
    if (state.categoryId !== categoryId || nav.type !== type) return;
    state.displayed = items;
    applyFilterAndRender();
  } catch (err) {
    setBrowseMessage('Failed to load items');
    toast(err.message);
  }
}

async function loadAllForType(type) {
  setCategoryHeader('all', ALL_LABELS[type]);
  renderShelf();
  const instant = allLoaded(type);
  if (!instant) showGridSkeleton(type);
  try {
    const items = await loadAll(type);
    if (state.categoryId !== 'all' || nav.type !== type) return;
    state.displayed = items.filter((it) => !isCatHidden(type, it.category_id));
    applyFilterAndRender();
    if (!instant) toast(`Loaded ${state.displayed.length.toLocaleString()} ${type === 'live' ? 'channels' : type === 'vod' ? 'movies' : 'shows'}`);
  } catch (err) {
    toast(err.message);
    setBrowseMessage('Failed to load everything');
  }
}

function emptyMessage(query) {
  if (!query && EMPTY[state.categoryId]) return EMPTY[state.categoryId];
  return query ? `No results for “${query}”.` : 'Nothing here.';
}

export function applyFilterAndRender() {
  const type = nav.type;
  const query = el.searchBox.value.trim();
  const folded = fold(query);
  const items = folded ? state.displayed.filter((it) => matchesQuery(it, folded)) : state.displayed;
  if (isGuide()) renderGuide(items, emptyMessage(query));
  else renderGrid(items, type, query);
}

function applyLiveMode() {
  const guide = isGuide();
  el.liveMode.hidden = nav.type !== 'live';
  el.liveMode.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === state.liveMode));
  el.contentArea.classList.toggle('guide-mode', guide);
  el.contentGrid.hidden = guide;
  el.guide.hidden = !guide;
  if (!guide) clearGuide();
}

// Renders items in batches as the user scrolls, instead of creating
// thousands of DOM nodes up front for large VOD/series libraries.
function renderGrid(items, type, query) {
  if (gridObserver) {
    gridObserver.disconnect();
    gridObserver = null;
  }
  el.contentGrid.classList.toggle('aspect-wide', type === 'live');
  el.contentGrid.innerHTML = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-msg';
    empty.textContent = emptyMessage(query);
    el.contentGrid.appendChild(empty);
    if (query && state.categoryId !== 'all') {
      const more = document.createElement('button');
      more.className = 'action-btn search-all-btn';
      more.textContent = `Search ${ALL_LABELS[type]}`;
      more.addEventListener('click', () => loadAllForType(type));
      el.contentGrid.appendChild(more);
    }
    return;
  }

  const sentinel = document.createElement('div');
  sentinel.className = 'scroll-sentinel';
  el.contentGrid.appendChild(sentinel);

  let rendered = 0;
  const observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) appendBatch();
  }, { root: el.contentArea, rootMargin: '800px' });
  gridObserver = observer;

  function appendBatch() {
    const slice = items.slice(rendered, rendered + BATCH_SIZE);
    const frag = document.createDocumentFragment();
    slice.forEach((item) => frag.appendChild(buildCard(item, type, items)));
    el.contentGrid.insertBefore(frag, sentinel);
    rendered += slice.length;
    if (rendered >= items.length) {
      observer.disconnect();
      sentinel.remove();
    }
  }

  appendBatch();
  if (rendered < items.length) observer.observe(sentinel);
}

function buildCard(item, type, railItems) {
  const card = document.createElement('div');
  card.className = 'card';
  makeActivatable(card, item.name || 'Untitled');

  const thumb = document.createElement('div');
  thumb.className = `card-thumb ${type === 'live' ? 'aspect-wide logo' : 'aspect-poster'}`;
  fillThumb(thumb, item.stream_icon || item.cover || item.movie_image || '', type === 'live' ? 'tv' : 'film',
    type === 'series' ? posterFallback(item) : null);
  if (type !== 'live') thumb.insertAdjacentHTML('beforeend', `<span class="play-glyph">${icon('play', true)}</span>`);

  const title = document.createElement('div');
  title.className = 'card-title';
  card.append(thumb, title);
  if (type === 'live') {
    title.innerHTML = channelTitleHtml(item.name);
    card.title = item.name || '';
    thumb.insertAdjacentHTML('beforeend', '<div class="progress epg-bar" hidden><i></i></div>');
    card.insertAdjacentHTML('beforeend', '<div class="card-sub epg-title"></div>');
    card.appendChild(favButton(item, 'card-fav'));
    watchEpg(card, item.stream_id);
  } else {
    title.textContent = item.name || 'Untitled';
  }

  card.addEventListener('click', () => {
    if (type === 'live') openTheater(item, railItems);
    else if (type === 'vod') openMovie(item);
    else if (type === 'series') openSeries(item);
  });
  return card;
}

// ---------- Shelf: Favourites (Live) / Continue Watching (Movies, Shows) ----------

function renderShelf() {
  el.shelfRow.innerHTML = '';
  const searching = !!el.searchBox.value.trim();
  let cards = [];
  if (nav.type === 'live') {
    if (state.categoryId !== 'favs') {
      el.shelfTitle.textContent = 'Favourites';
      cards = library.favs.map((ch) => buildCard(ch, 'live', library.favs));
    }
  } else {
    el.shelfTitle.textContent = 'Continue Watching';
    cards = continueEntries(nav.type === 'vod' ? 'movie' : 'series').map(buildContinueCard);
  }
  el.shelfRow.style.gridAutoColumns = nav.type === 'live' ? '200px' : '';
  cards.forEach((c) => el.shelfRow.appendChild(c));
  el.shelf.hidden = searching || !cards.length || isGuide();
}

function buildContinueCard(entry) {
  const card = document.createElement('div');
  card.className = 'card';
  makeActivatable(card, entry.name);
  const thumb = document.createElement('div');
  thumb.className = 'card-thumb aspect-wide';
  const image = entry.kind === 'series' ? (entry.episode.image || entry.image) : (entry.backdrop || entry.image);
  fillThumb(thumb, image, 'film',
    entry.kind === 'series' ? episodeFallback(entrySeries(entry), entry.episode.season, entry.episode.episode_num) : null);
  thumb.insertAdjacentHTML('beforeend', `<span class="play-glyph">${icon('play', true)}</span>`);
  if (entry.duration > 0 && entry.position > 0) {
    const pct = Math.min(100, (entry.position / entry.duration) * 100);
    thumb.insertAdjacentHTML('beforeend', `<div class="progress"><i style="width:${pct.toFixed(1)}%"></i></div>`);
  }

  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = entry.name;
  const sub = document.createElement('div');
  sub.className = 'card-sub';
  const left = entry.duration > 0 && entry.position > 0 ? `${fmtDuration(entry.duration - entry.position)} left` : '';
  if (entry.kind === 'series') {
    const label = `S${entry.episode.season} · E${entry.episode.episode_num}`;
    sub.textContent = entry.position > 0 ? [label, left].filter(Boolean).join(' · ') : `Up next · ${label}`;
  } else {
    sub.textContent = left;
  }

  const remove = document.createElement('button');
  remove.className = 'card-fav card-remove';
  remove.title = 'Remove from Continue Watching';
  remove.innerHTML = icon('close');
  remove.addEventListener('click', (e) => {
    e.stopPropagation();
    removeContinue(entry.key);
  });

  card.append(thumb, title, sub, remove);
  card.addEventListener('click', () => resumeEntry(entry));
  return card;
}

async function resumeEntry(entry) {
  if (entry.kind === 'movie') {
    playMovie({ stream_id: entry.id, name: entry.name, stream_icon: entry.image, container_extension: entry.ext }, { push: true, back: TAB_LABELS.vod });
    return;
  }
  try {
    const info = await getSeriesInfo(entry.id);
    const series = entrySeries(entry);
    const found = flatEpisodes(info).find((x) => String(x.ep.id) === String(entry.episode.id));
    if (!found) throw new Error('That episode is no longer available');
    openEpisode(series, info, found.ep, found.season, { push: true, back: TAB_LABELS.series });
  } catch (err) {
    toast(err.message);
  }
}

// Re-syncs the browse page with the library (favourites changed, progress saved).
export function refreshBrowse() {
  renderShelf();
  if (nav.type !== 'live') return;
  updateFavCount();
  if (state.categoryId === 'favs' || state.categoryId === 'recent') {
    state.displayed = (state.categoryId === 'favs' ? library.favs : library.recents).slice();
    applyFilterAndRender();
  }
}

// Called every 30s: keeps the guide's now-line and programmes current.
export function tickBrowse() {
  if (isGuide() && !el.guide.hidden && !refreshGuide()) applyFilterAndRender();
}

export const focusSearch = () => { el.searchBox.focus(); el.searchBox.select(); };

export function initBrowse() {
  el.tabs.forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.type !== nav.type) switchTab(btn.dataset.type);
  }));

  el.liveMode.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (state.liveMode === b.dataset.mode) return;
    state.liveMode = b.dataset.mode;
    store.setRaw(LIVE_MODE_KEY, state.liveMode);
    applyLiveMode();
    renderShelf();
    if (state.categoryId) applyFilterAndRender();
  }));

  // Filtering a large "All Movies" list on every keystroke made typing laggy.
  const onSearch = debounce(() => {
    renderShelf();
    applyFilterAndRender();
  }, 150);
  el.searchBox.addEventListener('input', onSearch);

  el.catFilter.addEventListener('input', () => renderCategoryList());
}
