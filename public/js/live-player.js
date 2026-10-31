// One live channel playing in one <video>: hls.js setup, error recovery, restarts on
// a fresh provider edge, and a stall watchdog. Used by the theater and by multiview.

import { streamUrl } from './api.js';

const LIVE_HLS_CONFIG = {
  // The default (Infinity) keeps every played segment in the media buffer; over a
  // long match that hits the browser's buffer quota and stalls playback.
  backBufferLength: 30,
  manifestLoadingMaxRetry: 6,
  manifestLoadingRetryDelay: 1000,
  levelLoadingMaxRetry: 6,
  levelLoadingRetryDelay: 1000,
  fragLoadingMaxRetry: 8,
  fragLoadingRetryDelay: 1000,
};
const LIVE_STALL_RESTART_MS = 12000;
const MAX_LIVE_RESTARTS = 6;
const LIVE_TOLERANCE_S = 8;
const UNPLAYABLE_ERRORS = ['manifestIncompatibleCodecsError', 'bufferIncompatibleCodecsError', 'bufferAddCodecError'];

function rangesOverlap(a, b) {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (a.start(i) < b.end(j) && b.start(j) < a.end(i)) return true;
    }
  }
  return false;
}

// onGiveUp(kind, item, detail): the channel can't play. kind is 'desync' (provider feed
// broken), 'unsupported' (codec) or 'lost' (out of restarts). onChange(): state moved on
// (for live-button style indicators); called about once a second while playing.
export function createLivePlayer(video, { onGiveUp = () => {}, onChange = () => {} } = {}) {
  let hls = null;
  let s = null; // { item, restarts, mediaRecoveries, restartTimer, stopped, lastTime, lastProgressAt }
  let watchdog = null;

  // Each (re)start resolves the channel URL again, which lands on a fresh provider edge.
  // That is the right move after a fatal error or a real stall (dead edge, expired token),
  // but never during normal playback, where hls.js must keep reloading the edge it is on.
  function start() {
    const sess = s;
    if (hls) { hls.destroy(); hls = null; }
    sess.stopped = false;
    sess.lastTime = video.currentTime;
    sess.lastProgressAt = Date.now();

    const src = streamUrl('live', sess.item.stream_id, 'm3u8');
    const Hls = window.Hls;
    if (!(Hls && Hls.isSupported())) {
      video.src = src;
      video.play().catch(() => {});
      return;
    }

    const h = new Hls(LIVE_HLS_CONFIG);
    hls = h;
    h.on(Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
    h.on(Hls.Events.FRAG_BUFFERED, () => {
      sess.restarts = 0;
      sess.mediaRecoveries = 0;
    });
    // Some provider feeds carry audio and video timestamps minutes apart (same on every
    // edge). The browser only plays where both tracks overlap, so it would wait forever.
    h.on(Hls.Events.BUFFER_APPENDED, (_evt, data) => {
      const { audio, video: vid } = data.timeRanges || {};
      if (h !== hls || !audio || !vid || !audio.length || !vid.length) return;
      if (!rangesOverlap(audio, vid) && Math.abs(audio.start(0) - vid.start(0)) > 10) {
        setTimeout(() => { if (h === hls) giveUp('desync'); }, 0);
      }
    });
    h.on(Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal || h !== hls) return;
      if (UNPLAYABLE_ERRORS.includes(data.details)) {
        giveUp('unsupported', data.details);
        return;
      }
      if (data.type === Hls.ErrorTypes.MEDIA_ERROR && sess.mediaRecoveries < 2) {
        sess.mediaRecoveries += 1;
        h.recoverMediaError();
        return;
      }
      scheduleRestart(data.details);
    });
    h.loadSource(src);
    h.attachMedia(video);
  }

  // Stops playback but keeps the session, so "Go live" can retry it.
  function halt() {
    if (s) {
      clearTimeout(s.restartTimer);
      s.restartTimer = null;
      s.stopped = true;
    }
    if (hls) { hls.destroy(); hls = null; }
    video.pause();
    video.removeAttribute('src');
    video.load();
  }

  function giveUp(kind, detail) {
    const item = s && s.item;
    halt();
    onChange();
    onGiveUp(kind, item, detail);
  }

  function scheduleRestart(reason) {
    const sess = s;
    if (!sess || sess.restartTimer) return;
    if (sess.restarts >= MAX_LIVE_RESTARTS) {
      giveUp('lost', reason);
      return;
    }
    const delay = Math.min(500 * 2 ** sess.restarts, 8000);
    sess.restarts += 1;
    sess.restartTimer = setTimeout(() => {
      sess.restartTimer = null;
      if (s === sess) start();
    }, delay);
  }

  // hls.js recovers from most hiccups itself, but if the edge stops producing segments
  // it just keeps waiting. Restart on a fresh edge when playback is frozen while not paused.
  function check() {
    if (!s) return;
    const now = Date.now();
    if (s.stopped || s.restartTimer || video.paused || video.seeking || video.currentTime !== s.lastTime) {
      s.lastTime = video.currentTime;
      s.lastProgressAt = now;
    } else if (now - s.lastProgressAt > LIVE_STALL_RESTART_MS) {
      s.lastProgressAt = now;
      scheduleRestart('stalled');
    }
    onChange();
  }

  function syncTarget() {
    if (hls) return Number.isFinite(hls.liveSyncPosition) ? hls.liveSyncPosition : null;
    return video.seekable.length ? video.seekable.end(video.seekable.length - 1) : null;
  }

  function restartNow() {
    if (!s) return;
    clearTimeout(s.restartTimer);
    s.restartTimer = null;
    s.restarts = 0;
    start();
    onChange();
  }

  return {
    video,
    get item() { return s ? s.item : null; },
    get stopped() { return !s || s.stopped; },

    play(item) {
      halt();
      s = { item, restarts: 0, mediaRecoveries: 0, restartTimer: null, stopped: false, lastTime: 0, lastProgressAt: Date.now() };
      start();
      if (!watchdog) watchdog = setInterval(check, 1000);
      onChange();
    },

    restartNow,

    isAtLive() {
      if (!s || s.stopped || video.paused) return false;
      const target = syncTarget();
      return target === null || target - video.currentTime < LIVE_TOLERANCE_S;
    },

    // Jumps to the live edge, or restarts the stream if it's stopped or stuck.
    goLive() {
      if (!s) return;
      const stuck = !video.paused && video.readyState < video.HAVE_FUTURE_DATA && Date.now() - s.lastProgressAt > 3000;
      if (s.stopped || stuck) {
        restartNow();
        return;
      }
      const target = syncTarget();
      if (target !== null) video.currentTime = target;
      video.play().catch(() => {});
      onChange();
    },

    close() {
      halt();
      s = null;
      clearInterval(watchdog);
      watchdog = null;
    },
  };
}
