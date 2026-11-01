// TV show page: hero with artwork, a resume button, and seasons of episodes.

import { $, icon, yearOf, fmtDuration, parseDurationSecs, actionButton, renderMetaLine, makeActivatable, toast } from './util.js';
import { apiXtream } from './api.js';
import { pushView, registerView, onViewChange, TAB_LABELS, backTo } from './views.js';
import { library } from './library.js';
import { fillThumb, probeImage, seriesArtwork, seriesArtworkDetails, episodeFallback, seriesRef, setBackground } from './artwork.js';
import { openEpisode } from './watch.js';

const body = () => $('#series-body');
let seriesInfoCache = {};
let seriesState = null; // { item, info, season }

export const resetSeries = () => { seriesInfoCache = {}; seriesState = null; };

export async function getSeriesInfo(seriesId) {
  if (!seriesInfoCache[seriesId]) {
    const info = await apiXtream('get_series_info', { series_id: seriesId });
    // Some providers return episodes as an array of season arrays instead of a map.
    if (Array.isArray(info.episodes)) {
      const map = {};
      info.episodes.forEach((list, i) => {
        if (list && list.length) map[(list[0] && list[0].season) || i + 1] = list;
      });
      info.episodes = map;
    }
    seriesInfoCache[seriesId] = info;
  }
  return seriesInfoCache[seriesId];
}

export function seasonNumbers(info) {
  return Object.keys(info.episodes || {}).sort((a, b) => Number(a) - Number(b));
}

export function seasonEpisodes(info, season) {
  return ((info.episodes || {})[season] || []).slice().sort((a, b) => Number(a.episode_num) - Number(b.episode_num));
}

export function flatEpisodes(info) {
  return seasonNumbers(info).flatMap((season) => seasonEpisodes(info, season).map((ep) => ({ season, ep })));
}

export const entrySeries = (entry) => entry.series || { series_id: entry.id, name: entry.name, cover: entry.image };

// Hero skeleton shared with the movie page while details load.
export const heroSkeleton = () => `
  <section class="hero"><div class="hero-inner">
    <div class="hero-poster card-thumb skeleton"></div>
    <div class="hero-text"><div class="skeleton skeleton-title"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line short"></div></div>
  </div></section>`;

export async function openSeries(item) {
  seriesState = { item, info: null, season: null };
  pushView('series', backTo(TAB_LABELS.series));
  body().innerHTML = heroSkeleton();
  try {
    const info = await getSeriesInfo(item.series_id);
    if (!seriesState || seriesState.item !== item) return;
    seriesState.info = info;
    renderSeriesView();
  } catch (err) {
    body().innerHTML = '<div class="loading-msg">Failed to load this show</div>';
    toast(err.message);
  }
}

// Picks what the big button on a show page should play: the episode in progress,
// the queued next episode, or the first one.
function seriesResumeTarget(item, info) {
  const entry = library.progress[`series:${item.series_id}`];
  const all = flatEpisodes(info);
  if (entry) {
    const found = all.find((x) => String(x.ep.id) === String(entry.episode.id));
    if (found) {
      const label = `S${found.season} · E${found.ep.episode_num}`;
      return { ...found, label: entry.position > 0 ? `Resume ${label}` : `Play ${label}` };
    }
  }
  return all[0] ? { ...all[0], label: `Play S${all[0].season} · E${all[0].ep.episode_num}` } : null;
}

export function buildHero() {
  const hero = document.createElement('section');
  hero.className = 'hero';
  hero.innerHTML = `
    <div class="hero-bg"></div>
    <div class="hero-inner">
      <div class="hero-poster card-thumb"></div>
      <div class="hero-text">
        <div class="eyebrow hero-eyebrow"></div>
        <h1></h1>
        <div class="meta-line"></div>
        <div class="action-row"></div>
        <p class="plot"></p>
        <dl class="credits"></dl>
      </div>
    </div>`;
  return hero;
}

export function renderCredits(dl, pairs) {
  dl.innerHTML = '';
  pairs.filter(([, v]) => v && String(v).trim()).forEach(([k, v]) => {
    const dt = document.createElement('dt');
    dt.textContent = k;
    const dd = document.createElement('dd');
    dd.textContent = String(v).trim();
    dl.append(dt, dd);
  });
}

function renderSeriesView() {
  if (!seriesState || !seriesState.info) return;
  const { item, info } = seriesState;
  const meta = info.info || {};
  const seasons = seasonNumbers(info);
  const providerBackdrop = (Array.isArray(meta.backdrop_path) && meta.backdrop_path[0]) || '';
  const poster = meta.cover || item.cover || '';
  const series = seriesRef({ ...item, name: meta.name || item.name, releaseDate: meta.releaseDate || item.releaseDate }, poster);

  const root = body();
  root.innerHTML = '';
  const hero = buildHero();
  fillThumb(hero.querySelector('.hero-poster'), poster, 'film', () => seriesArtwork(series).then((a) => a && (a.posterLarge || a.poster)));
  loadSeriesBackdrop(hero.querySelector('.hero-bg'), series, providerBackdrop, poster);
  hero.querySelector('h1').textContent = series.name;
  renderMetaLine(hero.querySelector('.meta-line'), [
    yearOf(meta.releaseDate || meta.releasedate || item.releaseDate),
    meta.genre,
    seasons.length ? `${seasons.length} Season${seasons.length > 1 ? 's' : ''}` : '',
  ], meta.rating || item.rating);
  hero.querySelector('.plot').textContent = meta.plot || item.plot || '';
  renderCredits(hero.querySelector('.credits'), [['Starring', meta.cast], ['Created by', meta.director]]);

  const target = seriesResumeTarget(item, info);
  if (target) {
    hero.querySelector('.action-row').appendChild(actionButton(target.label, 'play',
      () => openEpisode(series, info, target.ep, target.season, { push: true, back: series.name }), true));
  }
  root.appendChild(hero);

  const content = document.createElement('section');
  content.className = 'detail-content';
  if (!seasons.length) {
    content.innerHTML = '<div class="empty-msg">No episodes found for this show.</div>';
    root.appendChild(content);
    return;
  }
  if (!seriesState.season || !seasons.includes(seriesState.season)) seriesState.season = target ? target.season : seasons[0];

  const header = document.createElement('div');
  header.className = 'episodes-header';
  header.innerHTML = '<h3 class="section-title">Episodes</h3>';
  const pills = document.createElement('div');
  pills.className = 'pill-row';
  header.appendChild(pills);
  const grid = document.createElement('div');
  grid.className = 'episode-grid';

  const showSeason = (season) => {
    seriesState.season = season;
    renderSeasonPills(pills, seasons, season, showSeason);
    grid.innerHTML = '';
    seasonEpisodes(info, season).forEach((ep) => {
      grid.appendChild(buildEpisodeCard(series, ep, season, false, () => openEpisode(series, info, ep, season, { push: true, back: series.name })));
    });
  };
  showSeason(seriesState.season);
  content.append(header, grid);
  root.appendChild(content);
}

// Provider backdrop if it loads, else the matched show's backdrop, else a poster.
async function loadSeriesBackdrop(node, series, providerBackdrop, poster) {
  let url = null;
  if (await probeImage(providerBackdrop)) url = providerBackdrop;
  if (!url) {
    const [art, details] = await Promise.all([seriesArtwork(series), seriesArtworkDetails(series)]);
    url = (details && details.backdrop) || null;
    if (!url && await probeImage(poster)) url = poster;
    if (!url && art) url = art.posterLarge || art.poster;
  }
  setBackground(node, url);
}

export function renderSeasonPills(container, seasons, active, onPick) {
  container.innerHTML = '';
  if (seasons.length < 2) return;
  seasons.forEach((s) => {
    const b = document.createElement('button');
    b.className = `pill${s === active ? ' active' : ''}`;
    b.textContent = `Season ${s}`;
    b.addEventListener('click', () => onPick(s));
    container.appendChild(b);
  });
}

export function buildEpisodeCard(series, ep, season, isCurrent, onClick) {
  const card = document.createElement('div');
  card.className = `card ep-card${isCurrent ? ' current' : ''}`;
  makeActivatable(card, ep.title || `Episode ${ep.episode_num}`);
  const thumb = document.createElement('div');
  thumb.className = 'card-thumb';
  fillThumb(thumb, (ep.info && ep.info.movie_image) || series.cover, 'film', episodeFallback(series, season, ep.episode_num));
  thumb.insertAdjacentHTML('beforeend', `<span class="play-glyph">${icon('play', true)}</span>`);
  const prog = library.episodes[ep.id];
  if (prog && prog.done) {
    thumb.insertAdjacentHTML('beforeend', `<span class="watched-check" title="Watched">${icon('check')}</span>`);
  } else if (prog && prog.d > 0 && prog.p > 0) {
    thumb.insertAdjacentHTML('beforeend', `<div class="progress"><i style="width:${Math.min(100, (prog.p / prog.d) * 100).toFixed(1)}%"></i></div>`);
  }

  const secs = parseDurationSecs(ep.info);
  const label = document.createElement('div');
  label.className = 'ep-label';
  label.textContent = [`Episode ${ep.episode_num}`, secs ? fmtDuration(secs) : ''].filter(Boolean).join(' · ');
  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = ep.title || `Episode ${ep.episode_num}`;
  card.append(thumb, label, title);
  if (ep.info && ep.info.plot) {
    const plot = document.createElement('div');
    plot.className = 'ep-plot';
    plot.textContent = ep.info.plot;
    card.appendChild(plot);
  }
  card.addEventListener('click', onClick);
  return card;
}

export function initSeries() {
  registerView('series', $('#series-view'), () => !!seriesState);
  // Coming back from an episode: redraw so watched marks and the resume button update.
  onViewChange((prev, next) => { if (next === 'series' && prev !== 'series') renderSeriesView(); });
}
