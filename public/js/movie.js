// Movie page: backdrop, poster, details and a Play / Resume button, like a show page.

import { $, yearOf, fmtClock, fmtDuration, parseDurationSecs, actionButton, renderMetaLine, toast } from './util.js';
import { apiXtream } from './api.js';
import { pushView, registerView, onViewChange, TAB_LABELS, backTo } from './views.js';
import { library } from './library.js';
import { fillThumb, firstLoadable, setBackground } from './artwork.js';
import { heroSkeleton, buildHero, renderCredits } from './series.js';
import { playMovie } from './watch.js';

const body = () => $('#movie-body');
const vodInfoCache = {};
let movieState = null; // { item, info }

export const resetMovies = () => { movieState = null; Object.keys(vodInfoCache).forEach((k) => delete vodInfoCache[k]); };

// get_vod_info's "info" block ({} when the provider has nothing).
export async function getMovieInfo(item) {
  const id = item.stream_id;
  if (!vodInfoCache[id]) {
    vodInfoCache[id] = apiXtream('get_vod_info', { vod_id: id })
      .then((data) => (data && data.info && !Array.isArray(data.info) ? data.info : {}))
      .catch((err) => { delete vodInfoCache[id]; throw err; });
  }
  return vodInfoCache[id];
}

export const movieBackdrop = (info) => (Array.isArray(info.backdrop_path) && info.backdrop_path[0]) || '';

export async function openMovie(item) {
  movieState = { item, info: null };
  pushView('movie', backTo(TAB_LABELS.vod));
  body().innerHTML = heroSkeleton();
  let info = {};
  try {
    info = await getMovieInfo(item);
  } catch (err) {
    toast(`Couldn't load the details: ${err.message}`);
  }
  if (!movieState || movieState.item !== item) return;
  movieState.info = info;
  renderMovieView();
}

function renderMovieView() {
  if (!movieState || !movieState.info) return;
  const { item, info } = movieState;
  const root = body();
  root.innerHTML = '';
  const hero = buildHero();
  hero.classList.add('movie-hero');
  const poster = item.stream_icon || info.movie_image || info.cover_big || '';
  fillThumb(hero.querySelector('.hero-poster'), poster, 'film');
  firstLoadable([movieBackdrop(info), info.cover_big, info.movie_image, poster])
    .then((url) => setBackground(hero.querySelector('.hero-bg'), url));

  const secs = parseDurationSecs(info);
  hero.querySelector('h1').textContent = info.name || item.name || 'Untitled';
  renderMetaLine(hero.querySelector('.meta-line'), [
    yearOf(info.releasedate || info.release_date || item.year || item.releaseDate),
    secs ? fmtDuration(secs) : '',
    info.genre,
  ], info.rating || item.rating);
  hero.querySelector('.plot').textContent = info.plot || info.description || '';
  renderCredits(hero.querySelector('.credits'), [['Starring', info.cast || info.actors], ['Director', info.director]]);

  const actions = hero.querySelector('.action-row');
  const saved = library.progress[`movie:${item.stream_id}`];
  const back = info.name || item.name || 'Movie';
  if (saved && saved.position > 10) {
    const left = saved.duration > 0 ? ` · ${fmtDuration(saved.duration - saved.position)} left` : '';
    actions.appendChild(actionButton(`Resume from ${fmtClock(saved.position)}`, 'play', () => playMovie(item, { info, push: true, back }), true));
    actions.appendChild(actionButton('Start Over', 'restart', () => playMovie(item, { info, push: true, back, fromStart: true })));
    hero.querySelector('.hero-eyebrow').textContent = `In progress${left}`;
    if (saved.duration > 0) {
      hero.querySelector('.hero-eyebrow').insertAdjacentHTML('beforeend',
        `<div class="hero-progress"><i style="width:${Math.min(100, (saved.position / saved.duration) * 100).toFixed(1)}%"></i></div>`);
    }
  } else {
    actions.appendChild(actionButton('Play', 'play', () => playMovie(item, { info, push: true, back }), true));
  }
  root.appendChild(hero);
}

export function initMovies() {
  registerView('movie', $('#movie-view'), () => !!movieState);
  // Coming back from the player: refresh the resume button.
  onViewChange((prev, next) => { if (next === 'movie' && prev !== 'movie') renderMovieView(); });
}
