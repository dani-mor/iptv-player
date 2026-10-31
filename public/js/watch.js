// Watch view: the full-page player for movies and episodes, with resume, progress
// saving, next-episode autoplay and playback options.

import { $, fmtClock, fmtDuration, yearOf, parseDurationSecs, actionButton, renderMetaLine, toast } from './util.js';
import { streamUrl } from './api.js';
import { pushView, registerView, onViewChange, TAB_LABELS } from './views.js';
import { library, saveLibrary, bindVolume } from './library.js';
import { firstLoadable, seriesRef, episodeFallback } from './artwork.js';
import { seasonNumbers, seasonEpisodes, flatEpisodes, renderSeasonPills, buildEpisodeCard } from './series.js';
import { getMovieInfo, movieBackdrop } from './movie.js';

const WATCHED_RATIO = 0.94;
const MIN_RESUME_S = 10;
const SPEEDS = [1, 1.25, 1.5, 2, 0.75];

const el = {
  view: $('#watch-view'),
  video: $('#watch-video'),
  eyebrow: $('#watch-eyebrow'),
  title: $('#watch-title'),
  meta: $('#watch-meta'),
  actions: $('#watch-actions'),
  plot: $('#watch-plot'),
  error: $('#watch-error'),
  episodes: $('#watch-episodes'),
  seasons: $('#watch-seasons'),
  episodeRow: $('#watch-episode-row'),
};

let watch = null; // current movie / episode session
let playbackSpeed = 1;

export const watchVideo = () => el.video;

function setPoster(urls) {
  const s = watch;
  firstLoadable(urls).then((url) => {
    if (url && watch === s && el.video.readyState < el.video.HAVE_CURRENT_DATA) el.video.poster = url;
  });
}

function renderMovieDetails(item, info) {
  const secs = parseDurationSecs(info);
  watch.durationHint = secs || watch.durationHint;
  watch.backdrop = movieBackdrop(info);
  renderMetaLine(el.meta, [
    yearOf(info.releasedate || info.release_date || item.year),
    secs ? fmtDuration(secs) : '',
    info.genre,
  ], info.rating || item.rating);
  el.plot.textContent = info.plot || info.description || '';
}

export function playMovie(item, { info = null, push = false, back = TAB_LABELS.vod, fromStart = false } = {}) {
  const ext = item.container_extension || 'mp4';
  const key = `movie:${item.stream_id}`;
  const saved = library.progress[key];
  watch = { kind: 'movie', key, movie: item, ext, image: item.stream_icon || '', backdrop: '', durationHint: 0 };
  if (push) pushView('watch', back);

  el.eyebrow.textContent = '';
  el.title.textContent = (info && info.name) || item.name || 'Untitled';
  renderMetaLine(el.meta, [yearOf(item.year || item.releaseDate)], item.rating);
  el.plot.textContent = '';
  el.episodes.hidden = true;
  renderWatchActions();
  startWatchPlayback(streamUrl('movie', item.stream_id, ext), saved && !fromStart ? saved.position : 0);

  const s = watch;
  const withInfo = (i) => {
    if (watch !== s) return;
    renderMovieDetails(item, i);
    setPoster([movieBackdrop(i), i.cover_big, item.stream_icon]);
  };
  if (info) withInfo(info);
  else getMovieInfo(item).then(withInfo).catch(() => setPoster([item.stream_icon]));
}

export function openEpisode(series, info, ep, season, { push = false, back } = {}) {
  if (watch) recordProgress(true);
  clearTimeout(watch && watch.nextTimer);
  const ext = ep.container_extension || 'mp4';
  const prog = library.episodes[ep.id];
  watch = {
    kind: 'episode',
    key: `series:${series.series_id}`,
    series,
    info,
    ep,
    season,
    ext,
    image: series.cover,
    durationHint: parseDurationSecs(ep.info),
    browseSeason: season,
  };
  if (push) pushView('watch', back);

  el.eyebrow.textContent = `${series.name} · Season ${season}, Episode ${ep.episode_num}`;
  el.title.textContent = ep.title || `Episode ${ep.episode_num}`;
  const epInfo = ep.info || {};
  renderMetaLine(el.meta, [
    yearOf(epInfo.releasedate || epInfo.air_date),
    watch.durationHint ? fmtDuration(watch.durationHint) : '',
  ], epInfo.rating);
  el.plot.textContent = epInfo.plot || '';
  renderWatchActions();
  renderWatchEpisodes();
  el.view.scrollTop = 0;
  startWatchPlayback(streamUrl('series', ep.id, ext), prog && !prog.done ? prog.p : 0);
  const s = watch;
  episodeFallback(series, season, ep.episode_num)().catch(() => null)
    .then((alt) => { if (watch === s) setPoster([epInfo.movie_image, alt, series.cover]); });
}

function neighbourEpisode(offset) {
  if (!watch || watch.kind !== 'episode') return null;
  const all = flatEpisodes(watch.info);
  const i = all.findIndex((x) => String(x.ep.id) === String(watch.ep.id));
  return i >= 0 ? all[i + offset] || null : null;
}

function playNeighbour(offset) {
  const n = neighbourEpisode(offset);
  if (n) openEpisode(watch.series, watch.info, n.ep, n.season);
}

function renderWatchActions() {
  el.actions.innerHTML = '';
  const v = el.video;
  const add = (b) => el.actions.appendChild(b);
  if (watch.kind === 'episode') {
    const prev = actionButton('Previous', 'prev', () => playNeighbour(-1));
    prev.disabled = !neighbourEpisode(-1);
    const next = actionButton('Next Episode', 'next', () => playNeighbour(1), true);
    next.disabled = !neighbourEpisode(1);
    add(next);
    add(prev);
  }
  add(actionButton('Start Over', 'restart', () => { v.currentTime = 0; v.play().catch(() => {}); }));
  add(actionButton('10s', 'rewind', () => seekBy(-10)));
  add(actionButton('10s', 'forward', () => seekBy(10)));
  const speed = actionButton(`${playbackSpeed}×`, 'speed', () => {
    playbackSpeed = SPEEDS[(SPEEDS.indexOf(playbackSpeed) + 1) % SPEEDS.length];
    v.defaultPlaybackRate = playbackSpeed;
    v.playbackRate = playbackSpeed;
    speed.querySelector('span').textContent = `${playbackSpeed}×`;
    speed.classList.toggle('on', playbackSpeed !== 1);
  });
  speed.title = 'Playback speed';
  speed.classList.toggle('on', playbackSpeed !== 1);
  add(speed);
  if (document.pictureInPictureEnabled) {
    add(actionButton('Picture in Picture', 'pip', () => {
      if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
      else v.requestPictureInPicture().catch(() => {});
    }));
  }
  add(actionButton('Full Screen', 'fullscreen', () => toggleFullscreen(v)));
}

function renderWatchEpisodes() {
  const { info, series } = watch;
  const seasons = seasonNumbers(info);
  el.episodes.hidden = !seasons.length;
  const show = (season) => {
    watch.browseSeason = season;
    renderSeasonPills(el.seasons, seasons, season, show);
    el.episodeRow.innerHTML = '';
    let current = null;
    seasonEpisodes(info, season).forEach((ep) => {
      const isCurrent = String(ep.id) === String(watch.ep.id);
      const card = buildEpisodeCard(series, ep, season, isCurrent, () => {
        if (!isCurrent) openEpisode(series, info, ep, season);
      });
      if (isCurrent) current = card;
      el.episodeRow.appendChild(card);
    });
    if (current) el.episodeRow.scrollLeft = Math.max(0, current.offsetLeft - el.episodeRow.offsetLeft - 40);
  };
  show(watch.browseSeason);
}

export function seekBy(delta) {
  const v = el.video;
  const max = Number.isFinite(v.duration) ? v.duration : Infinity;
  v.currentTime = Math.min(max, Math.max(0, v.currentTime + delta));
}

export function toggleFullscreen(node) {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else node.requestFullscreen().catch(() => {});
}

function startWatchPlayback(src, resumeAt) {
  const v = el.video;
  watch.ready = false;
  watch.resumeAt = resumeAt > MIN_RESUME_S ? resumeAt : 0;
  watch.lastSaved = 0;
  el.error.hidden = true;
  v.pause();
  v.removeAttribute('src');
  v.removeAttribute('poster');
  v.load();
  v.defaultPlaybackRate = playbackSpeed;
  v.playbackRate = playbackSpeed;
  v.src = src;
  v.play().catch(() => {});
}

function watchDuration() {
  const d = el.video.duration;
  return Number.isFinite(d) && d > 0 ? d : (watch && watch.durationHint) || 0;
}

// Saves the playback position at most every 5s (or immediately when forced, e.g. on
// pause or leaving), and keeps the Continue Watching entry pointing at the right place.
function recordProgress(force) {
  if (!watch || !watch.ready) return;
  const now = Date.now();
  if (!force && now - watch.lastSaved < 5000) return;
  const pos = el.video.currentTime;
  const dur = watchDuration();
  const done = dur > 0 && pos / dur >= WATCHED_RATIO;
  if (pos < MIN_RESUME_S && !done) return;
  watch.lastSaved = now;

  if (watch.kind === 'movie') {
    if (done) {
      delete library.progress[watch.key];
    } else {
      library.progress[watch.key] = {
        key: watch.key, kind: 'movie', id: watch.movie.stream_id, name: watch.movie.name, ext: watch.ext,
        image: watch.image, backdrop: watch.backdrop, position: pos, duration: dur, updatedAt: now,
      };
    }
  } else {
    library.episodes[watch.ep.id] = { p: done ? 0 : pos, d: dur, done };
    let target = { season: watch.season, ep: watch.ep };
    let position = pos;
    if (done) {
      target = neighbourEpisode(1);
      position = 0;
    }
    if (target) {
      library.progress[watch.key] = {
        key: watch.key, kind: 'series', id: watch.series.series_id, name: watch.series.name, image: watch.series.cover,
        series: seriesRef(watch.series),
        episode: {
          id: target.ep.id, season: target.season, episode_num: target.ep.episode_num,
          title: target.ep.title, image: (target.ep.info && target.ep.info.movie_image) || '',
        },
        position, duration: done ? 0 : dur, updatedAt: now,
      };
    } else {
      delete library.progress[watch.key];
    }
  }
  saveLibrary();
}

export function closeWatch() {
  if (!watch) return;
  recordProgress(true);
  clearTimeout(watch.nextTimer);
  watch = null;
  const v = el.video;
  if (document.pictureInPictureElement === v) document.exitPictureInPicture().catch(() => {});
  v.pause();
  v.removeAttribute('src');
  v.removeAttribute('poster');
  v.load();
}

export function initWatch() {
  registerView('watch', el.view, () => !!watch);
  onViewChange((prev, next) => { if (prev === 'watch' && next !== 'watch') closeWatch(); });

  const v = el.video;
  bindVolume(v);
  v.addEventListener('loadedmetadata', () => {
    if (!watch) return;
    const dur = watchDuration();
    const at = watch.resumeAt;
    if (at && (!dur || at < dur - 30)) {
      v.currentTime = at;
      toast(`Resumed from ${fmtClock(at)}`, { label: 'Start Over', run: () => { v.currentTime = 0; } });
    }
    watch.ready = true;
  });
  v.addEventListener('timeupdate', () => recordProgress(false));
  v.addEventListener('pause', () => recordProgress(true));
  v.addEventListener('error', () => {
    if (!watch || !v.error) return;
    el.error.textContent = v.error.code === v.error.MEDIA_ERR_SRC_NOT_SUPPORTED
      ? `This video (${watch.ext.toUpperCase()}) can't be played in the browser, or the provider couldn't serve it.`
      : 'Playback failed. The provider may be unavailable, try again in a moment.';
    el.error.hidden = false;
  });
  v.addEventListener('ended', () => {
    if (!watch) return;
    recordProgress(true);
    const next = neighbourEpisode(1);
    if (!next) return;
    const s = watch;
    s.nextTimer = setTimeout(() => { if (watch === s) playNeighbour(1); }, 6000);
    toast(`Up next: Episode ${next.ep.episode_num}${next.ep.title ? ` · ${next.ep.title}` : ''}`, {
      label: 'Cancel', duration: 6000, run: () => clearTimeout(s.nextTimer),
    });
  });
  window.addEventListener('beforeunload', () => recordProgress(true));
}
