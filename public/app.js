(() => {
  const STORAGE_KEY = 'iptv_player_creds';
  const LAST_TAB_KEY = 'iptv_last_tab';
  const CONCURRENCY = 5;
  const BATCH_SIZE = 120;

  const $ = (sel) => document.querySelector(sel);

  const el = {
    loginScreen: $('#login-screen'),
    loginForm: $('#login-form'),
    loginBtn: $('#login-btn'),
    loginError: $('#login-error'),
    inServer: $('#in-server'),
    inUsername: $('#in-username'),
    inPassword: $('#in-password'),
    inUa: $('#in-ua'),
    inRemember: $('#in-remember'),

    appScreen: $('#app-screen'),
    backBtn: $('#back-btn'),
    backLabel: $('#back-label'),
    brand: $('#brand'),
    tabsNav: $('#tabs'),
    tabs: document.querySelectorAll('#tabs .tab-btn'),
    topbarRight: $('.topbar-right'),
    searchBox: $('#search-box'),
    accountInfo: $('#account-info'),
    logoutBtn: $('#logout-btn'),

    browseView: $('#browse-view'),
    categoryList: $('#category-list'),
    contentArea: $('#content-area'),
    shelf: $('#shelf'),
    shelfTitle: $('#shelf-title'),
    shelfRow: $('#shelf-row'),
    gridTitle: $('#grid-title'),
    contentGrid: $('#content-grid'),
    liveMode: $('#live-mode'),
    guide: $('#guide'),

    theaterView: $('#theater-view'),
    theaterVideo: $('#theater-video'),
    theaterChannelName: $('#theater-channel-name'),
    theaterEpg: $('#theater-epg'),
    theaterSchedule: $('#theater-schedule'),
    theaterSearch: $('#theater-search'),
    theaterChannelList: $('#theater-channel-list'),
    theaterLiveBtn: $('#theater-live-btn'),
    theaterLiveLabel: $('#theater-live-btn .live-label'),
    theaterFavBtn: $('#theater-fav-btn'),
    theaterMuteBtn: $('#theater-mute-btn'),
    theaterVolume: $('#theater-volume'),

    seriesView: $('#series-view'),
    seriesBody: $('#series-body'),

    watchView: $('#watch-view'),
    watchVideo: $('#watch-video'),
    watchEyebrow: $('#watch-eyebrow'),
    watchTitle: $('#watch-title'),
    watchMeta: $('#watch-meta'),
    watchActions: $('#watch-actions'),
    watchPlot: $('#watch-plot'),
    watchError: $('#watch-error'),
    watchEpisodes: $('#watch-episodes'),
    watchSeasons: $('#watch-seasons'),
    watchEpisodeRow: $('#watch-episode-row'),

    toast: $('#toast'),
    toastMsg: $('#toast-msg'),
    toastAction: $('#toast-action'),
  };

  const ICON_PATHS = {
    play: '<path d="M7.5 5.2v13.6a1 1 0 0 0 1.53.85l10.6-6.8a1 1 0 0 0 0-1.7L9.03 4.35A1 1 0 0 0 7.5 5.2z"/>',
    star: '<path d="M12 3.6l2.55 5.2 5.75.83-4.16 4.05.98 5.72L12 16.7l-5.12 2.7.98-5.72L3.7 9.63l5.75-.83z"/>',
    volume: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/>',
    mute: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/>',
    rewind: '<path d="M11 7l-6 5 6 5zM19 7l-6 5 6 5z"/>',
    forward: '<path d="M13 7l6 5-6 5zM5 7l6 5-6 5z"/>',
    restart: '<path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4.5v4h4"/>',
    pip: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="11.5" width="6.5" height="5" rx="1"/>',
    fullscreen: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    next: '<path d="M6 6.5l8.5 5.5L6 17.5z"/><path d="M18 6v12"/>',
    prev: '<path d="M18 6.5L9.5 12l8.5 5.5z"/><path d="M6 6v12"/>',
    speed: '<path d="M4.5 16.5a8 8 0 1 1 15 0"/><path d="M12 13.5l3.5-4"/>',
    check: '<path d="M5.5 12.5l4 4 9-9"/>',
    close: '<path d="M7 7l10 10M17 7L7 17"/>',
    tv: '<rect x="3" y="5" width="18" height="12" rx="2.5"/><path d="M8 20.5h8"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.8"/><rect x="13" y="4" width="7" height="7" rx="1.8"/><rect x="4" y="13" width="7" height="7" rx="1.8"/><rect x="13" y="13" width="7" height="7" rx="1.8"/>',
    film: '<rect x="4" y="4" width="16" height="16" rx="2.5"/><path d="M8 4v16M16 4v16M4 9h4M4 15h4M16 9h4M16 15h4"/>',
  };
  const icon = (name, filled = false) => `<svg viewBox="0 0 24 24"${filled ? ' class="filled"' : ''}>${ICON_PATHS[name]}</svg>`;

  let creds = null; // { server, username, password, ua }
  let currentType = 'live';
  let categoriesCache = {}; // type -> [categories]
  let streamsCache = {}; // `${type}:${categoryId}` -> [items]
  let allLoadedForType = {}; // type -> bool
  let allItemsCache = {}; // type -> merged items
  let seriesInfoCache = {}; // series_id -> get_series_info response
  let currentCategoryId = null;
  let currentCategoryName = '';
  let currentDisplayed = [];
  let gridObserver = null;
  let view = 'browse';
  let liveMode = 'grid'; // Live TV browse: 'grid' of channels or timeline 'guide'
  try { if (localStorage.getItem('iptv_live_mode') === 'guide') liveMode = 'guide'; } catch { /* ignore */ }

  let theaterHls = null;
  let theaterRailItems = [];
  let theaterActiveId = null;
  let liveSession = null; // { item, restarts, mediaRecoveries, restartTimer, stopped, lastTime, lastProgressAt }
  let liveWatchdog = null;

  let seriesState = null; // { item, info, season }
  let watch = null; // current movie / episode session
  let playbackSpeed = 1;

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

  const WATCHED_RATIO = 0.94;
  const MIN_RESUME_S = 10;
  const SPEEDS = [1, 1.25, 1.5, 2, 0.75];
  const TAB_LABELS = { live: 'Live TV', vod: 'Movies', series: 'TV Shows' };
  const ALL_LABELS = { live: 'All Channels', vod: 'All Movies', series: 'All Shows' };

  function showScreen(name) {
    el.loginScreen.hidden = name !== 'login';
    el.appScreen.hidden = name !== 'app';
  }

  let toastTimer = null;
  function toast(msg, action) {
    el.toastMsg.textContent = msg;
    el.toastAction.hidden = !action;
    if (action) {
      el.toastAction.textContent = action.label;
      el.toastAction.onclick = () => { el.toast.hidden = true; action.run(); };
    }
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, (action && action.duration) || 3500);
  }

  function qs(obj) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) {
      if (v !== undefined && v !== null && v !== '') params.set(k, v);
    }
    return params.toString();
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function fmtClock(secs) {
    secs = Math.max(0, Math.floor(secs));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = String(secs % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function fmtDuration(secs) {
    const mins = Math.round(secs / 60);
    if (mins < 60) return `${mins} min`;
    return `${Math.floor(mins / 60)} h ${mins % 60} min`;
  }

  // Provider durations come as "01:52:10" strings and/or a duration_secs number.
  function parseDurationSecs(info) {
    if (!info) return 0;
    if (Number(info.duration_secs) > 0) return Number(info.duration_secs);
    const m = /^(\d+):(\d{2}):(\d{2})$/.exec(String(info.duration || '').trim());
    return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
  }

  function yearOf(str) {
    const m = /(19|20)\d{2}/.exec(String(str || ''));
    return m ? m[0] : '';
  }

  // One shared observer for "do this once the element scrolls near the screen":
  // fallback artwork lookups and EPG fetches only happen for what the user can see.
  const visibleCallbacks = new WeakMap();
  const lazyObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const cbs = visibleCallbacks.get(entry.target) || [];
      visibleCallbacks.delete(entry.target);
      lazyObserver.unobserve(entry.target);
      cbs.forEach((cb) => cb());
    });
  }, { rootMargin: '300px' });

  function whenVisible(node, cb) {
    const cbs = visibleCallbacks.get(node);
    if (cbs) { cbs.push(cb); return; }
    visibleCallbacks.set(node, [cb]);
    lazyObserver.observe(node);
  }

  // Tracks image hosts that never deliver, so cards skip straight to the fallback
  // instead of each waiting on a dead server.
  const hostHealth = {};
  const hostOf = (url) => { try { return new URL(url, location.href).host; } catch { return ''; } };
  function noteHost(url, ok) {
    const h = hostHealth[hostOf(url)] || (hostHealth[hostOf(url)] = { ok: 0, fail: 0 });
    if (ok) h.ok += 1; else h.fail += 1;
  }
  function hostIsDead(url) {
    const h = hostHealth[hostOf(url)];
    return !!h && h.ok === 0 && h.fail >= 3;
  }

  // Loads an image with a fade-in over a placeholder glyph. If it fails (or its host is
  // known dead) and a fallback is given, asks the fallback for another URL once visible.
  function fillThumb(container, url, fallbackIcon, fallback) {
    container.insertAdjacentHTML('afterbegin', `<span class="placeholder">${icon(fallbackIcon)}</span>`);
    const show = (src, onFail) => {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.onload = () => { noteHost(src, true); img.classList.add('loaded'); container.classList.add('has-img'); };
      img.onerror = () => { noteHost(src, false); img.remove(); if (onFail) onFail(); };
      img.src = src;
      container.firstElementChild.after(img);
    };
    const tryFallback = fallback && (() => whenVisible(container, () => {
      fallback().then((alt) => { if (alt) show(alt, null); }).catch(() => {});
    }));
    if (url && !hostIsDead(url)) show(url, tryFallback);
    else if (tryFallback) tryFallback();
  }

  function probeImage(url) {
    return new Promise((resolve) => {
      if (!url || hostIsDead(url)) { resolve(false); return; }
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => { noteHost(url, true); resolve(true); };
      img.onerror = () => { noteHost(url, false); resolve(false); };
      img.src = url;
    });
  }

  // ---------- Show artwork fallback (server matches shows on TMDB / TVmaze) ----------

  const artworkMemo = {};
  const artworkDetailsMemo = {};
  const fetchJson = (url) => fetch(url).then((r) => (r.ok ? r.json() : null)).catch(() => null);

  function seriesArtwork(series) {
    const id = series.series_id;
    if (!artworkMemo[id]) {
      artworkMemo[id] = fetchJson(`/api/artwork/series?${qs({ name: series.name, year: yearOf(series.releaseDate || series.year), tmdb: series.tmdb_id })}`);
    }
    return artworkMemo[id];
  }

  async function seriesArtworkDetails(series) {
    const art = await seriesArtwork(series);
    if (!art || !art.id) return null;
    if (!artworkDetailsMemo[art.id]) artworkDetailsMemo[art.id] = fetchJson(`/api/artwork/show/${encodeURIComponent(art.id)}`);
    return artworkDetailsMemo[art.id];
  }

  const posterFallback = (series) => () => seriesArtwork(series).then((a) => a && a.poster);

  const episodeFallback = (series, season, episodeNum) => async () => {
    const [art, details] = await Promise.all([seriesArtwork(series), seriesArtworkDetails(series)]);
    return (details && (details.episodes[`${season}:${episodeNum}`] || details.backdrop)) || (art && art.poster) || null;
  };

  // Keeps only the fields artwork lookups need, so they survive in saved progress.
  const seriesRef = (s, cover) => ({
    series_id: s.series_id, name: s.name, cover: cover || s.cover, releaseDate: s.releaseDate || s.year, tmdb_id: s.tmdb_id || s.tmdb,
  });

  // ---------- EPG (programme guide) ----------

  const EPG_CONCURRENCY = 3;
  const epgCache = {}; // `${kind}:${streamId}` -> { listings, at, promise }
  const epgQueue = [];
  let epgActive = 0;

  function epgRequest(action, params, urgent) {
    return new Promise((resolve, reject) => {
      const job = { action, params, resolve, reject };
      if (urgent) epgQueue.unshift(job); else epgQueue.push(job);
      pumpEpg();
    });
  }

  function pumpEpg() {
    while (epgActive < EPG_CONCURRENCY && epgQueue.length) {
      const job = epgQueue.shift();
      epgActive += 1;
      apiXtream(job.action, job.params).then(job.resolve, job.reject).finally(() => {
        epgActive -= 1;
        pumpEpg();
      });
    }
  }

  // Timestamps are UTC epochs; the "start"/"end" strings are in the provider's timezone,
  // so they're only a fallback (treated as UTC).
  function parseListing(l) {
    const ts = (n, str) => (Number(n) > 0 ? Number(n) * 1000 : Date.parse(String(str || '').replace(' ', 'T') + 'Z'));
    return {
      start: ts(l.start_timestamp, l.start),
      end: ts(l.stop_timestamp || l.end_timestamp, l.end || l.stop),
      title: b64decode(l.title) || 'Untitled',
      desc: b64decode(l.description),
    };
  }

  function epgNeedsFetch(entry) {
    if (!entry) return true;
    if (entry.promise) return false;
    const now = Date.now();
    if (entry.listings.some((l) => l.start <= now && l.end > now)) return false;
    return now - entry.at > (entry.listings.length ? 60e3 : 15 * 60e3);
  }

  // kind "short" = now/next (cheap, for cards and lists); "full" = whole schedule.
  function loadEpg(streamId, kind = 'short', urgent = false) {
    const key = `${kind}:${streamId}`;
    const entry = epgCache[key];
    if (!epgNeedsFetch(entry)) return entry.promise || Promise.resolve(entry.listings);
    const action = kind === 'full' ? 'get_simple_data_table' : 'get_short_epg';
    const params = kind === 'full' ? { stream_id: streamId } : { stream_id: streamId, limit: 4 };
    const fresh = { listings: entry ? entry.listings : [], at: Date.now(), promise: null };
    fresh.promise = epgRequest(action, params, urgent)
      .then((data) => {
        const now = Date.now();
        fresh.listings = (data.epg_listings || [])
          .map(parseListing)
          .filter((l) => l.end > now - 6 * 3600e3 && l.start < now + 48 * 3600e3)
          .sort((a, b) => a.start - b.start);
      })
      .catch(() => {})
      .then(() => {
        fresh.at = Date.now();
        fresh.promise = null;
        return fresh.listings;
      });
    epgCache[key] = fresh;
    return fresh.promise;
  }

  function epgListings(streamId) {
    const full = epgCache[`full:${streamId}`];
    if (full && full.listings.length) return full.listings;
    const short = epgCache[`short:${streamId}`];
    return short ? short.listings : [];
  }

  function nowProgram(streamId) {
    const now = Date.now();
    return epgListings(streamId).find((l) => l.start <= now && l.end > now) || null;
  }

  const progressPct = (p) => Math.min(100, Math.max(0, ((Date.now() - p.start) / (p.end - p.start)) * 100));
  const fmtTime = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // Any element with data-epg-id shows that channel's current programme in its
  // .epg-title and .epg-bar children.
  function paintEpg(node) {
    const p = nowProgram(node.dataset.epgId);
    const title = node.querySelector('.epg-title');
    const bar = node.querySelector('.epg-bar');
    if (title) title.textContent = p ? p.title : '';
    if (bar) {
      bar.hidden = !p;
      if (p) bar.firstElementChild.style.width = `${progressPct(p).toFixed(1)}%`;
    }
  }

  function paintEpgFor(streamId) {
    document.querySelectorAll(`[data-epg-id="${CSS.escape(String(streamId))}"]`).forEach(paintEpg);
  }

  function watchEpg(node, streamId) {
    node.dataset.epgId = streamId;
    paintEpg(node);
    whenVisible(node, () => loadEpg(streamId).then(() => paintEpgFor(streamId)));
  }

  // Keeps progress bars moving and rolls over to the next programme when one ends.
  setInterval(() => {
    if (el.appScreen.hidden || document.hidden) return;
    document.querySelectorAll('[data-epg-id]').forEach((node) => {
      paintEpg(node);
      const id = node.dataset.epgId;
      if (!nowProgram(id) && epgNeedsFetch(epgCache[`short:${id}`])) {
        whenVisible(node, () => loadEpg(id).then(() => paintEpgFor(id)));
      }
    });
    if (view === 'theater' && liveSession) updateTheaterEpg();
    if (view === 'browse' && !el.guide.hidden) refreshGuide();
  }, 30000);

  function saveCreds(c, remember) {
    if (remember) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }

  function loadCreds() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  async function apiXtream(action, extra = {}) {
    const query = qs({ ...creds, action, ...extra });
    const r = await fetch(`/api/xtream?${query}`);
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || `Request failed (${r.status})`);
    return data;
  }

  async function doLogin(c) {
    const r = await fetch(`/api/login?${qs(c)}`);
    const data = await r.json();
    if (!r.ok || data.error) throw new Error(data.error || `Login failed (${r.status})`);
    return data;
  }

  function formatExpiry(userInfo) {
    if (!userInfo) return '';
    if (userInfo.exp_date && !isNaN(Number(userInfo.exp_date))) {
      const d = new Date(Number(userInfo.exp_date) * 1000);
      return `Expires ${d.toLocaleDateString()}`;
    }
    return userInfo.status ? `Status: ${userInfo.status}` : '';
  }

  // ---------- Library: favourites + continue watching (per account, in localStorage) ----------

  let library = { favs: [], progress: {}, episodes: {} };
  const libraryKey = () => `iptv_library:${creds.username}@${creds.server}`;

  function loadLibrary() {
    try {
      library = { favs: [], progress: {}, episodes: {}, ...JSON.parse(localStorage.getItem(libraryKey()) || '{}') };
    } catch {
      library = { favs: [], progress: {}, episodes: {} };
    }
  }

  function saveLibrary() {
    try {
      localStorage.setItem(libraryKey(), JSON.stringify(library));
    } catch {
      // storage full or blocked: progress just won't persist
    }
  }

  // Each window saves the whole library, so pick up other windows' saves right away;
  // otherwise two open windows would overwrite each other's favourites and progress.
  window.addEventListener('storage', (e) => {
    if (!creds || e.key !== libraryKey()) return;
    loadLibrary();
    refreshFavUI();
  });

  const isFav = (id) => library.favs.some((f) => String(f.stream_id) === String(id));

  function toggleFav(ch) {
    if (isFav(ch.stream_id)) {
      library.favs = library.favs.filter((f) => String(f.stream_id) !== String(ch.stream_id));
    } else {
      library.favs.push({ stream_id: ch.stream_id, name: ch.name, stream_icon: ch.stream_icon, category_id: ch.category_id });
    }
    saveLibrary();
    refreshFavUI();
  }

  function favButton(ch, className) {
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

  function paintFavButton(btn, on) {
    btn.classList.toggle('is-fav', on);
    btn.innerHTML = icon('star', on);
    btn.title = on ? 'Remove from favourites' : 'Add to favourites';
  }

  function refreshFavUI() {
    document.querySelectorAll('[data-fav-id]').forEach((b) => paintFavButton(b, isFav(b.dataset.favId)));
    if (liveSession) paintFavButton(el.theaterFavBtn, isFav(liveSession.item.stream_id));
    if (view === 'browse') refreshBrowse();
  }

  // Re-syncs the browse page with the library (favourites changed, progress saved).
  function refreshBrowse() {
    renderShelf();
    if (currentType !== 'live') return;
    updateFavCount();
    if (currentCategoryId === 'favs') {
      currentDisplayed = library.favs.slice();
      applyFilterAndRender(currentType);
    }
  }

  function continueEntries(kind) {
    return Object.values(library.progress)
      .filter((p) => p.kind === kind)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  function removeContinue(key) {
    delete library.progress[key];
    saveLibrary();
    renderShelf();
  }

  // ---------- Views & navigation ----------

  // Views sit on top of each other in browser history so the back button, mouse back
  // and Esc all step out one level (watch -> series -> browse).
  function setView(name, backLabel) {
    if (view === 'theater' && name !== 'theater') closeTheater();
    if (view === 'watch' && name !== 'watch') closeWatch();
    view = name;
    el.browseView.hidden = name !== 'browse';
    el.theaterView.hidden = name !== 'theater';
    el.seriesView.hidden = name !== 'series';
    el.watchView.hidden = name !== 'watch';

    const browsing = name === 'browse';
    el.backBtn.hidden = browsing;
    el.brand.hidden = !browsing;
    el.tabsNav.style.visibility = browsing ? '' : 'hidden';
    el.topbarRight.style.visibility = browsing ? '' : 'hidden';
    el.backLabel.textContent = backLabel || TAB_LABELS[currentType];

    if (browsing) refreshBrowse();
    if (name === 'series' && seriesState) renderSeriesView();
  }

  function pushView(name, backLabel) {
    history.pushState({ view: name, back: backLabel }, '');
    setView(name, backLabel);
  }

  window.addEventListener('popstate', (e) => {
    if (!creds) return;
    const state = e.state || {};
    let name = state.view || 'browse';
    if (name === 'series' && !seriesState) name = 'browse';
    if ((name === 'watch' && !watch) || (name === 'theater' && !liveSession)) name = 'browse';
    setView(name, state.back);
  });

  el.backBtn.addEventListener('click', () => history.back());

  document.addEventListener('keydown', (e) => {
    if (el.appScreen.hidden || e.target.closest('input, textarea, select')) return;
    if (e.key === 'Escape' && view !== 'browse' && !document.fullscreenElement) {
      history.back();
      return;
    }
    const v = view === 'watch' ? el.watchVideo : view === 'theater' ? el.theaterVideo : null;
    if (!v || e.target === v || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ' || e.key === 'k') {
      e.preventDefault();
      if (v.paused) v.play().catch(() => {}); else v.pause();
    } else if (e.key === 'f') {
      toggleFullscreen(v);
    } else if (e.key === 'm') {
      v.muted = !v.muted;
      if (v === el.theaterVideo) { el.theaterVolume.value = v.muted ? 0 : v.volume; updateMuteIcon(); }
    } else if (view === 'watch' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      seekBy(e.key === 'ArrowLeft' ? -10 : 10);
    }
  });

  function toggleFullscreen(v) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else v.requestFullscreen().catch(() => {});
  }

  // ---------- Login flow ----------

  el.loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    el.loginError.hidden = true;
    const candidate = {
      server: el.inServer.value.trim(),
      username: el.inUsername.value.trim(),
      password: el.inPassword.value,
      ua: el.inUa.value.trim() || 'IPTVSmartersPlayer',
    };
    el.loginBtn.disabled = true;
    el.loginBtn.textContent = 'Connecting…';
    try {
      const data = await doLogin(candidate);
      creds = candidate;
      saveCreds(creds, el.inRemember.checked);
      enterApp(data.user_info);
    } catch (err) {
      el.loginError.textContent = err.message;
      el.loginError.hidden = false;
    } finally {
      el.loginBtn.disabled = false;
      el.loginBtn.textContent = 'Connect';
    }
  });

  el.logoutBtn.addEventListener('click', () => {
    setView('browse');
    localStorage.removeItem(STORAGE_KEY);
    creds = null;
    categoriesCache = {};
    streamsCache = {};
    allLoadedForType = {};
    allItemsCache = {};
    seriesInfoCache = {};
    seriesState = null;
    showScreen('login');
  });

  function enterApp(userInfo) {
    loadLibrary();
    el.accountInfo.textContent = formatExpiry(userInfo);
    showScreen('app');
    history.replaceState({ view: 'browse' }, '');
    setView('browse');
    let lastTab = 'live';
    try { lastTab = localStorage.getItem(LAST_TAB_KEY) || 'live'; } catch { /* ignore */ }
    switchTab(TAB_LABELS[lastTab] ? lastTab : 'live');
  }

  async function tryAutoLogin() {
    const stored = loadCreds();
    if (!stored) {
      showScreen('login');
      return;
    }
    el.inServer.value = stored.server;
    el.inUsername.value = stored.username;
    el.inPassword.value = stored.password;
    el.inUa.value = stored.ua || 'IPTVSmartersPlayer';
    try {
      const data = await doLogin(stored);
      creds = stored;
      enterApp(data.user_info);
    } catch (err) {
      showScreen('login');
      el.loginError.textContent = `Saved session expired: ${err.message}`;
      el.loginError.hidden = false;
    }
  }

  // ---------- Tabs / categories ----------

  function switchTab(type) {
    el.tabs.forEach((b) => b.classList.toggle('active', b.dataset.type === type));
    currentType = type;
    try { localStorage.setItem(LAST_TAB_KEY, type); } catch { /* ignore */ }
    el.searchBox.value = '';
    applyLiveMode();
    loadCategories(type);
  }

  el.tabs.forEach((btn) => btn.addEventListener('click', () => {
    if (btn.dataset.type !== currentType) switchTab(btn.dataset.type);
  }));

  const ACTIONS = {
    live: { categories: 'get_live_categories', streams: 'get_live_streams' },
    vod: { categories: 'get_vod_categories', streams: 'get_vod_streams' },
    series: { categories: 'get_series_categories', streams: 'get_series' },
  };

  async function loadCategories(type) {
    currentCategoryId = null;
    el.categoryList.innerHTML = '<div class="loading-msg">Loading…</div>';
    el.contentGrid.innerHTML = '';
    el.gridTitle.textContent = '';
    renderShelf();
    try {
      if (!categoriesCache[type]) {
        categoriesCache[type] = await apiXtream(ACTIONS[type].categories);
      }
      if (type !== currentType) return;
      renderCategoryList(type, categoriesCache[type]);
      if (type === 'live' && library.favs.length) {
        selectCategory(type, 'favs', 'Favourites');
      } else {
        const first = categoriesCache[type][0];
        if (first) selectCategory(type, first.category_id, first.category_name);
      }
    } catch (err) {
      el.categoryList.innerHTML = '<div class="loading-msg">Failed to load categories</div>';
      toast(err.message);
    }
  }

  function categoryItem(id, name, iconName) {
    const item = document.createElement('div');
    item.className = 'category-item';
    item.dataset.categoryId = id;
    item.title = name;
    item.innerHTML = `${iconName ? icon(iconName, iconName === 'star') : ''}<span class="cat-name">${escapeHtml(name)}</span>`;
    return item;
  }

  function renderCategoryList(type, categories) {
    el.categoryList.innerHTML = '';
    if (type === 'live') {
      const fav = categoryItem('favs', 'Favourites', 'star');
      fav.insertAdjacentHTML('beforeend', '<span class="count"></span>');
      fav.addEventListener('click', () => selectCategory(type, 'favs', 'Favourites'));
      el.categoryList.appendChild(fav);
      updateFavCount();
    }
    const allItem = categoryItem('all', ALL_LABELS[type], 'grid');
    allItem.addEventListener('click', () => loadAllForType(type));
    el.categoryList.appendChild(allItem);

    const heading = document.createElement('div');
    heading.className = 'category-heading';
    heading.textContent = 'Categories';
    el.categoryList.appendChild(heading);

    categories.forEach((cat) => {
      const item = categoryItem(cat.category_id, cat.category_name);
      item.addEventListener('click', () => selectCategory(type, cat.category_id, cat.category_name));
      el.categoryList.appendChild(item);
    });
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
    const target = el.guide.hidden ? el.contentGrid : el.guide;
    target.innerHTML = `<div class="loading-msg">${escapeHtml(msg)}</div>`;
  }

  function setCategoryHeader(id, name) {
    currentCategoryId = id;
    currentCategoryName = name;
    markActiveCategory(id);
    el.gridTitle.textContent = name || '';
    el.searchBox.placeholder = `Search ${name || ''}`.trim();
    el.contentArea.scrollTop = 0;
  }

  async function selectCategory(type, categoryId, categoryName) {
    setCategoryHeader(categoryId, categoryName);
    renderShelf();
    if (categoryId === 'favs') {
      currentDisplayed = library.favs.slice();
      applyFilterAndRender(type);
      return;
    }
    const cacheKey = `${type}:${categoryId}`;
    setBrowseMessage('Loading…');
    try {
      if (!streamsCache[cacheKey]) {
        streamsCache[cacheKey] = await apiXtream(ACTIONS[type].streams, { category_id: categoryId });
      }
      if (currentCategoryId !== categoryId || currentType !== type) return;
      currentDisplayed = streamsCache[cacheKey];
      applyFilterAndRender(type);
    } catch (err) {
      setBrowseMessage('Failed to load items');
      toast(err.message);
    }
  }

  async function loadAllForType(type) {
    setCategoryHeader('all', ALL_LABELS[type]);
    renderShelf();
    if (allLoadedForType[type]) {
      currentDisplayed = allItemsCache[type];
      applyFilterAndRender(type);
      return;
    }
    setBrowseMessage('Loading every category, this can take a moment…');
    try {
      const categories = categoriesCache[type] || (categoriesCache[type] = await apiXtream(ACTIONS[type].categories));
      const results = [];
      let idx = 0;
      async function worker() {
        while (idx < categories.length) {
          const cat = categories[idx++];
          const cacheKey = `${type}:${cat.category_id}`;
          try {
            if (!streamsCache[cacheKey]) {
              streamsCache[cacheKey] = await apiXtream(ACTIONS[type].streams, { category_id: cat.category_id });
            }
            results.push(...streamsCache[cacheKey]);
          } catch {
            // skip categories that fail to load
          }
        }
      }
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      allItemsCache[type] = results;
      allLoadedForType[type] = true;
      if (currentCategoryId !== 'all' || currentType !== type) return;
      currentDisplayed = results;
      applyFilterAndRender(type);
      toast(`Loaded ${results.length} items across ${categories.length} categories`);
    } catch (err) {
      toast(err.message);
      setBrowseMessage('Failed to load all categories');
    }
  }

  function applyFilterAndRender(type) {
    const query = el.searchBox.value.trim().toLowerCase();
    let items = currentDisplayed;
    if (query) {
      items = items.filter((it) => (it.name || '').toLowerCase().includes(query));
    }
    if (type === 'live' && liveMode === 'guide') renderGuide(items, query);
    else renderGrid(items, type, query);
  }

  function applyLiveMode() {
    const guide = currentType === 'live' && liveMode === 'guide';
    el.liveMode.hidden = currentType !== 'live';
    el.liveMode.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.mode === liveMode));
    el.contentArea.classList.toggle('guide-mode', guide);
    el.contentGrid.hidden = guide;
    el.guide.hidden = !guide;
    if (!guide) el.guide.innerHTML = '';
  }

  el.liveMode.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    if (liveMode === b.dataset.mode) return;
    liveMode = b.dataset.mode;
    try { localStorage.setItem('iptv_live_mode', liveMode); } catch { /* ignore */ }
    applyLiveMode();
    renderShelf();
    if (currentCategoryId) applyFilterAndRender(currentType);
  }));

  el.searchBox.addEventListener('input', () => {
    renderShelf();
    applyFilterAndRender(currentType);
  });

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
      if (currentCategoryId === 'favs' && !query) {
        empty.textContent = 'No favourites yet. Tap the star on any channel to add it here.';
      } else {
        empty.textContent = query ? `No results for “${query}”.` : 'Nothing here.';
      }
      el.contentGrid.appendChild(empty);
      if (query && currentCategoryId !== 'all') {
        const more = document.createElement('button');
        more.className = 'action-btn';
        more.style.cssText = 'grid-column:1/-1;justify-self:center';
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
    function appendBatch() {
      const slice = items.slice(rendered, rendered + BATCH_SIZE);
      const frag = document.createDocumentFragment();
      slice.forEach((item) => frag.appendChild(buildCard(item, type, items)));
      el.contentGrid.insertBefore(frag, sentinel);
      rendered += slice.length;
      if (rendered >= items.length) {
        gridObserver.disconnect();
        sentinel.remove();
      }
    }

    gridObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) appendBatch();
    }, { root: el.contentArea, rootMargin: '800px' });

    appendBatch();
    if (rendered < items.length) gridObserver.observe(sentinel);
  }

  // ---------- TV guide (timeline of programmes per channel) ----------

  const GUIDE_PX_PER_MIN = 5;
  const GUIDE_CH_W = 220;
  const GUIDE_HOURS = 12;
  const GUIDE_BATCH = 80;
  let guideState = null; // { t0, t1, items, rows: Map(streamId -> row) }

  const guideX = (ms) => ((ms - guideState.t0) / 60000) * GUIDE_PX_PER_MIN;

  function renderGuide(items, query) {
    const now = Date.now();
    const t0 = Math.floor(now / 1800e3) * 1800e3 - 1800e3;
    guideState = { t0, t1: t0 + GUIDE_HOURS * 3600e3, items, rows: new Map() };
    el.guide.innerHTML = '';
    if (!items.length) {
      el.guide.innerHTML = `<div class="empty-msg">${currentCategoryId === 'favs' && !query
        ? 'No favourites yet. Tap the star on any channel to add it here.'
        : escapeHtml(query ? `No results for “${query}”.` : 'Nothing here.')}</div>`;
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
    el.guide.appendChild(inner);

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
    el.guide.scrollLeft = Math.max(0, guideX(now) - 90);
  }

  function buildGuideRow(ch, railItems) {
    const row = document.createElement('div');
    row.className = 'guide-row';
    const chCell = document.createElement('div');
    chCell.className = 'guide-ch';
    const logo = document.createElement('div');
    logo.className = 'ch-logo';
    fillThumb(logo, ch.stream_icon, 'tv');
    const name = document.createElement('span');
    name.className = 'guide-ch-name';
    name.textContent = ch.name || 'Untitled';
    chCell.append(logo, name, favButton(ch, 'row-fav'));
    chCell.addEventListener('click', () => openTheater(ch, railItems));

    const track = document.createElement('div');
    track.className = 'guide-track';
    track.innerHTML = '<div class="guide-empty">Loading…</div>';
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
    const edge = el.guide.scrollLeft;
    scope.querySelectorAll('.guide-prog').forEach((b) => {
      const left = Number(b.dataset.left);
      const shift = edge > left ? Math.min(edge - left, Number(b.dataset.right) - left - 80) : 0;
      const pad = `${10 + Math.max(0, shift)}px`;
      if (b.style.paddingLeft !== pad) b.style.paddingLeft = pad;
    });
  }

  let guideScrollFrame = 0;
  el.guide.addEventListener('scroll', () => {
    if (guideScrollFrame) return;
    guideScrollFrame = requestAnimationFrame(() => {
      guideScrollFrame = 0;
      pinGuideTitles(el.guide);
    });
  }, { passive: true });

  function positionGuideNow() {
    const line = el.guide.querySelector('.guide-now');
    if (line && guideState) line.style.left = `${GUIDE_CH_W + guideX(Date.now())}px`;
  }

  function refreshGuide() {
    if (!guideState) return;
    if (Date.now() > guideState.t1 - 3600e3) { applyFilterAndRender(currentType); return; }
    positionGuideNow();
    guideState.rows.forEach((r) => {
      if (!r.loaded) return;
      if (epgNeedsFetch(epgCache[`full:${r.ch.stream_id}`]) && !nowProgram(r.ch.stream_id)) {
        loadEpg(r.ch.stream_id, 'full').then(() => renderGuideTrack(r));
      } else {
        renderGuideTrack(r);
      }
    });
  }

  function buildCard(item, type, railItems) {
    const card = document.createElement('div');
    card.className = 'card';

    const thumb = document.createElement('div');
    thumb.className = `card-thumb ${type === 'live' ? 'aspect-wide logo' : 'aspect-poster'}`;
    fillThumb(thumb, item.stream_icon || item.cover || item.movie_image || '', type === 'live' ? 'tv' : 'film',
      type === 'series' ? posterFallback(item) : null);
    if (type !== 'live') thumb.insertAdjacentHTML('beforeend', `<span class="play-glyph">${icon('play', true)}</span>`);

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = item.name || 'Untitled';

    card.appendChild(thumb);
    card.appendChild(title);
    if (type === 'live') {
      thumb.insertAdjacentHTML('beforeend', '<div class="progress epg-bar" hidden><i></i></div>');
      card.insertAdjacentHTML('beforeend', '<div class="card-sub epg-title"></div>');
      card.appendChild(favButton(item, 'card-fav'));
      watchEpg(card, item.stream_id);
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
    if (currentType === 'live') {
      if (currentCategoryId !== 'favs') {
        el.shelfTitle.textContent = 'Favourites';
        cards = library.favs.map((ch) => buildCard(ch, 'live', library.favs));
      }
    } else {
      el.shelfTitle.textContent = 'Continue Watching';
      cards = continueEntries(currentType === 'vod' ? 'movie' : 'series').map(buildContinueCard);
    }
    el.shelfRow.style.gridAutoColumns = currentType === 'live' ? '200px' : '';
    cards.forEach((c) => el.shelfRow.appendChild(c));
    el.shelf.hidden = searching || !cards.length || (currentType === 'live' && liveMode === 'guide');
  }

  function buildContinueCard(entry) {
    const card = document.createElement('div');
    card.className = 'card';
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

  const entrySeries = (entry) => entry.series || { series_id: entry.id, name: entry.name, cover: entry.image };

  async function resumeEntry(entry) {
    if (entry.kind === 'movie') {
      openMovie({ stream_id: entry.id, name: entry.name, stream_icon: entry.image, container_extension: entry.ext });
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

  // ---------- Series detail ----------

  async function getSeriesInfo(seriesId) {
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

  function seasonNumbers(info) {
    return Object.keys(info.episodes || {}).sort((a, b) => Number(a) - Number(b));
  }

  function seasonEpisodes(info, season) {
    return ((info.episodes || {})[season] || []).slice().sort((a, b) => Number(a.episode_num) - Number(b.episode_num));
  }

  function flatEpisodes(info) {
    return seasonNumbers(info).flatMap((season) => seasonEpisodes(info, season).map((ep) => ({ season, ep })));
  }

  async function openSeries(item) {
    seriesState = { item, info: null, season: null };
    pushView('series', TAB_LABELS.series);
    el.seriesBody.innerHTML = '<div class="loading-msg">Loading…</div>';
    try {
      const info = await getSeriesInfo(item.series_id);
      if (!seriesState || seriesState.item !== item) return;
      seriesState.info = info;
      if (view === 'series') renderSeriesView();
    } catch (err) {
      el.seriesBody.innerHTML = '<div class="loading-msg">Failed to load this show</div>';
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

  function renderSeriesView() {
    const { item, info } = seriesState;
    if (!info) return;
    const meta = info.info || {};
    const seasons = seasonNumbers(info);
    const providerBackdrop = (Array.isArray(meta.backdrop_path) && meta.backdrop_path[0]) || '';
    const poster = meta.cover || item.cover || '';
    const series = seriesRef({ ...item, name: meta.name || item.name, releaseDate: meta.releaseDate || item.releaseDate }, poster);

    el.seriesBody.innerHTML = '';
    const hero = document.createElement('section');
    hero.className = 'series-hero';
    hero.innerHTML = `
      <div class="series-hero-bg"></div>
      <div class="series-hero-inner">
        <div class="series-poster card-thumb"></div>
        <div class="series-hero-text">
          <h1></h1>
          <div class="meta-line"></div>
          <div class="action-row"></div>
          <p class="plot"></p>
        </div>
      </div>`;
    fillThumb(hero.querySelector('.series-poster'), poster, 'film', () => seriesArtwork(series).then((a) => a && (a.posterLarge || a.poster)));
    loadSeriesBackdrop(hero.querySelector('.series-hero-bg'), series, providerBackdrop, poster);
    hero.querySelector('h1').textContent = series.name;
    renderMetaLine(hero.querySelector('.meta-line'), [
      yearOf(meta.releaseDate || meta.releasedate || item.releaseDate),
      meta.genre,
      seasons.length ? `${seasons.length} Season${seasons.length > 1 ? 's' : ''}` : '',
    ], meta.rating || item.rating);
    hero.querySelector('.plot').textContent = meta.plot || item.plot || '';

    const target = seriesResumeTarget(item, info);
    if (target) {
      const play = actionButton(target.label, 'play', () => openEpisode(series, info, target.ep, target.season, { push: true, back: series.name }), true);
      hero.querySelector('.action-row').appendChild(play);
    }
    el.seriesBody.appendChild(hero);

    const content = document.createElement('section');
    content.className = 'series-content';
    if (!seasons.length) {
      content.innerHTML = '<div class="empty-msg">No episodes found for this show.</div>';
      el.seriesBody.appendChild(content);
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
    el.seriesBody.appendChild(content);
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
    if (url && node.isConnected) {
      node.style.backgroundImage = `url("${url.replace(/["\\\n]/g, '')}")`;
      node.classList.add('loaded');
    }
  }

  function renderSeasonPills(container, seasons, active, onPick) {
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

  function buildEpisodeCard(series, ep, season, isCurrent, onClick) {
    const card = document.createElement('div');
    card.className = `card ep-card${isCurrent ? ' current' : ''}`;
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

  function renderMetaLine(container, parts, rating) {
    container.innerHTML = '';
    const items = parts.filter(Boolean).map((p) => `<span>${escapeHtml(p)}</span>`);
    const r = Number(rating);
    if (r > 0) items.unshift(`<span class="star-rating">★ ${escapeHtml(r.toFixed(1))}</span>`);
    container.innerHTML = items.join('<span class="dot"></span>');
  }

  function actionButton(label, iconName, onClick, primary = false) {
    const b = document.createElement('button');
    b.className = `action-btn${primary ? ' primary' : ''}`;
    b.innerHTML = `${iconName ? icon(iconName, iconName === 'play') : ''}<span>${escapeHtml(label)}</span>`;
    b.addEventListener('click', onClick);
    return b;
  }

  // ---------- Watch view: movies & episodes ----------

  function openMovie(item) {
    const ext = item.container_extension || 'mp4';
    const key = `movie:${item.stream_id}`;
    const saved = library.progress[key];
    watch = { kind: 'movie', key, movie: item, ext, image: item.stream_icon || '', backdrop: '', durationHint: 0 };
    pushView('watch', TAB_LABELS.vod);

    el.watchEyebrow.textContent = '';
    el.watchTitle.textContent = item.name || 'Untitled';
    renderMetaLine(el.watchMeta, [yearOf(item.year || item.releaseDate)], item.rating);
    el.watchPlot.textContent = '';
    el.watchEpisodes.hidden = true;
    renderWatchActions();
    startWatchPlayback(`/stream?${qs({ ...creds, type: 'movie', id: item.stream_id, ext })}`, saved ? saved.position : 0);
    loadMovieInfo(item);
  }

  async function loadMovieInfo(item) {
    try {
      const data = await apiXtream('get_vod_info', { vod_id: item.stream_id });
      if (!watch || watch.movie !== item) return;
      const info = data && !Array.isArray(data.info) ? data.info || {} : {};
      const secs = parseDurationSecs(info);
      watch.durationHint = secs;
      watch.backdrop = (Array.isArray(info.backdrop_path) && info.backdrop_path[0]) || '';
      renderMetaLine(el.watchMeta, [
        yearOf(info.releasedate || info.release_date || item.year),
        secs ? fmtDuration(secs) : '',
        info.genre,
      ], info.rating || item.rating);
      el.watchPlot.textContent = info.plot || info.description || '';
    } catch {
      // details are optional; playback doesn't depend on them
    }
  }

  function openEpisode(series, info, ep, season, { push = false, back } = {}) {
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

    el.watchEyebrow.textContent = `${series.name} · Season ${season}, Episode ${ep.episode_num}`;
    el.watchTitle.textContent = ep.title || `Episode ${ep.episode_num}`;
    const epInfo = ep.info || {};
    renderMetaLine(el.watchMeta, [
      yearOf(epInfo.releasedate || epInfo.air_date),
      watch.durationHint ? fmtDuration(watch.durationHint) : '',
    ], epInfo.rating);
    el.watchPlot.textContent = epInfo.plot || '';
    renderWatchActions();
    renderWatchEpisodes();
    el.watchView.scrollTop = 0;
    startWatchPlayback(`/stream?${qs({ ...creds, type: 'series', id: ep.id, ext })}`, prog && !prog.done ? prog.p : 0);
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
    el.watchActions.innerHTML = '';
    const v = el.watchVideo;
    const add = (b) => el.watchActions.appendChild(b);
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
    el.watchEpisodes.hidden = !seasons.length;
    const show = (season) => {
      watch.browseSeason = season;
      renderSeasonPills(el.watchSeasons, seasons, season, show);
      el.watchEpisodeRow.innerHTML = '';
      let current = null;
      seasonEpisodes(info, season).forEach((ep) => {
        const isCurrent = String(ep.id) === String(watch.ep.id);
        const card = buildEpisodeCard(series, ep, season, isCurrent, () => {
          if (!isCurrent) openEpisode(series, info, ep, season);
        });
        if (isCurrent) current = card;
        el.watchEpisodeRow.appendChild(card);
      });
      if (current) el.watchEpisodeRow.scrollLeft = Math.max(0, current.offsetLeft - el.watchEpisodeRow.offsetLeft - 40);
    };
    show(watch.browseSeason);
  }

  function seekBy(delta) {
    const v = el.watchVideo;
    const max = Number.isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.min(max, Math.max(0, v.currentTime + delta));
  }

  function startWatchPlayback(src, resumeAt) {
    const v = el.watchVideo;
    watch.ready = false;
    watch.resumeAt = resumeAt > MIN_RESUME_S ? resumeAt : 0;
    watch.lastSaved = 0;
    el.watchError.hidden = true;
    v.pause();
    v.removeAttribute('src');
    v.load();
    v.defaultPlaybackRate = playbackSpeed;
    v.playbackRate = playbackSpeed;
    v.src = src;
    v.play().catch(() => {});
  }

  function watchDuration() {
    const d = el.watchVideo.duration;
    return Number.isFinite(d) && d > 0 ? d : (watch && watch.durationHint) || 0;
  }

  // Saves the playback position at most every 5s (or immediately when forced, e.g. on
  // pause or leaving), and keeps the Continue Watching entry pointing at the right place.
  function recordProgress(force) {
    if (!watch || !watch.ready) return;
    const now = Date.now();
    if (!force && now - watch.lastSaved < 5000) return;
    const pos = el.watchVideo.currentTime;
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

  function closeWatch() {
    if (!watch) return;
    recordProgress(true);
    clearTimeout(watch.nextTimer);
    watch = null;
    const v = el.watchVideo;
    if (document.pictureInPictureElement === v) document.exitPictureInPicture().catch(() => {});
    v.pause();
    v.removeAttribute('src');
    v.load();
  }

  const wv = el.watchVideo;
  wv.addEventListener('loadedmetadata', () => {
    if (!watch) return;
    const dur = watchDuration();
    const at = watch.resumeAt;
    if (at && (!dur || at < dur - 30)) {
      wv.currentTime = at;
      toast(`Resumed from ${fmtClock(at)}`, { label: 'Start Over', run: () => { wv.currentTime = 0; } });
    }
    watch.ready = true;
  });
  wv.addEventListener('timeupdate', () => recordProgress(false));
  wv.addEventListener('pause', () => recordProgress(true));
  wv.addEventListener('error', () => {
    if (!watch || !wv.error) return;
    el.watchError.textContent = wv.error.code === wv.error.MEDIA_ERR_SRC_NOT_SUPPORTED
      ? `This video (${watch.ext.toUpperCase()}) can't be played in the browser, or the provider couldn't serve it.`
      : 'Playback failed. The provider may be unavailable, try again in a moment.';
    el.watchError.hidden = false;
  });
  wv.addEventListener('ended', () => {
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

  // ---------- Live TV theater view ----------

  function openTheater(item, railItems) {
    theaterRailItems = railItems || currentDisplayed;
    theaterActiveId = item.stream_id;
    el.theaterSearch.value = '';
    pushView('theater', TAB_LABELS.live);
    renderChannelRail(theaterRailItems);
    playTheaterChannel(item);
    if (!liveWatchdog) liveWatchdog = setInterval(checkLiveProgress, 1000);
  }

  function closeTheater() {
    if (!liveSession && !liveWatchdog) return;
    stopLiveStream();
    liveSession = null;
    clearInterval(liveWatchdog);
    liveWatchdog = null;
  }

  el.theaterSearch.addEventListener('input', () => {
    const query = el.theaterSearch.value.trim().toLowerCase();
    const filtered = query ? theaterRailItems.filter((it) => (it.name || '').toLowerCase().includes(query)) : theaterRailItems;
    renderChannelRail(filtered);
  });

  el.theaterFavBtn.addEventListener('click', () => {
    if (liveSession) toggleFav(liveSession.item);
  });

  function updateMuteIcon() {
    const v = el.theaterVideo;
    const isMuted = v.muted || v.volume === 0;
    el.theaterMuteBtn.innerHTML = icon(isMuted ? 'mute' : 'volume');
    el.theaterMuteBtn.title = isMuted ? 'Unmute' : 'Mute';
  }

  el.theaterMuteBtn.addEventListener('click', () => {
    const v = el.theaterVideo;
    v.muted = !v.muted;
    if (!v.muted && v.volume === 0) v.volume = 1;
    el.theaterVolume.value = v.muted ? 0 : v.volume;
    updateMuteIcon();
  });

  el.theaterVolume.addEventListener('input', () => {
    const v = el.theaterVideo;
    v.volume = parseFloat(el.theaterVolume.value);
    v.muted = v.volume === 0;
    updateMuteIcon();
  });

  function liveSyncTarget() {
    const v = el.theaterVideo;
    if (theaterHls) return Number.isFinite(theaterHls.liveSyncPosition) ? theaterHls.liveSyncPosition : null;
    return v.seekable.length ? v.seekable.end(v.seekable.length - 1) : null;
  }

  function updateLiveButton() {
    const v = el.theaterVideo;
    const target = liveSyncTarget();
    const atLive = !!liveSession && !liveSession.stopped && !v.paused && (target === null || target - v.currentTime < LIVE_TOLERANCE_S);
    el.theaterLiveBtn.classList.toggle('at-live', atLive);
    const label = atLive ? 'LIVE' : 'Go live';
    if (el.theaterLiveLabel.textContent !== label) el.theaterLiveLabel.textContent = label;
    el.theaterLiveBtn.title = atLive ? 'Watching live' : 'Jump to live';
  }

  el.theaterLiveBtn.addEventListener('click', () => {
    const s = liveSession;
    if (!s) return;
    const v = el.theaterVideo;
    const stuck = !v.paused && v.readyState < v.HAVE_FUTURE_DATA && Date.now() - s.lastProgressAt > 3000;
    if (s.stopped || stuck) {
      restartLiveNow();
      return;
    }
    const target = liveSyncTarget();
    if (target !== null) v.currentTime = target;
    v.play().catch(() => {});
    updateLiveButton();
  });

  ['play', 'pause', 'seeked'].forEach((evt) => el.theaterVideo.addEventListener(evt, updateLiveButton));

  function renderChannelRail(items) {
    el.theaterChannelList.innerHTML = '';
    const frag = document.createDocumentFragment();
    items.forEach((ch) => {
      const row = document.createElement('div');
      row.className = 'theater-channel-row';
      row.classList.toggle('active', ch.stream_id === theaterActiveId);
      row.dataset.streamId = ch.stream_id;

      const logo = document.createElement('div');
      logo.className = 'ch-logo';
      if (ch.stream_icon) {
        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = ch.stream_icon;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.onerror = () => { logo.innerHTML = icon('tv'); };
        logo.appendChild(img);
      } else {
        logo.innerHTML = icon('tv');
      }

      const text = document.createElement('div');
      text.className = 'ch-text';
      const name = document.createElement('div');
      name.className = 'ch-name';
      name.textContent = ch.name || 'Untitled';
      text.appendChild(name);
      text.insertAdjacentHTML('beforeend', '<div class="ch-now epg-title"></div><div class="ch-bar epg-bar" hidden><i></i></div>');

      row.appendChild(logo);
      row.appendChild(text);
      row.appendChild(favButton(ch, 'row-fav'));
      watchEpg(row, ch.stream_id);
      row.addEventListener('click', () => playTheaterChannel(ch));
      frag.appendChild(row);
    });
    el.theaterChannelList.appendChild(frag);
  }

  function highlightActiveRow() {
    el.theaterChannelList.querySelectorAll('.theater-channel-row').forEach((row) => {
      row.classList.toggle('active', row.dataset.streamId === String(theaterActiveId));
    });
  }

  function rangesOverlap(a, b) {
    for (let i = 0; i < a.length; i++) {
      for (let j = 0; j < b.length; j++) {
        if (a.start(i) < b.end(j) && b.start(j) < a.end(i)) return true;
      }
    }
    return false;
  }

  // Each (re)start resolves the channel URL again, which lands on a fresh provider edge.
  // That is the right move after a fatal error or a real stall (dead edge, expired token),
  // but never during normal playback, where hls.js must keep reloading the edge it is on.
  function startLiveStream() {
    const s = liveSession;
    const v = el.theaterVideo;
    if (theaterHls) { theaterHls.destroy(); theaterHls = null; }
    s.stopped = false;
    s.lastTime = v.currentTime;
    s.lastProgressAt = Date.now();

    const src = `/stream?${qs({ ...creds, type: 'live', id: s.item.stream_id, ext: 'm3u8' })}`;
    if (!(window.Hls && window.Hls.isSupported())) {
      v.src = src;
      v.play().catch(() => {});
      return;
    }

    const hls = new window.Hls(LIVE_HLS_CONFIG);
    theaterHls = hls;
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => v.play().catch(() => {}));
    hls.on(window.Hls.Events.FRAG_BUFFERED, () => {
      s.restarts = 0;
      s.mediaRecoveries = 0;
    });
    // Some provider feeds carry audio and video timestamps minutes apart (same on every
    // edge). The browser only plays where both tracks overlap, so it would wait forever.
    hls.on(window.Hls.Events.BUFFER_APPENDED, (_evt, data) => {
      const { audio, video } = data.timeRanges || {};
      if (hls !== theaterHls || !audio || !video || !audio.length || !video.length) return;
      if (!rangesOverlap(audio, video) && Math.abs(audio.start(0) - video.start(0)) > 10) {
        setTimeout(() => {
          if (hls !== theaterHls) return;
          toast("This channel's audio and video are out of sync at the provider, so it can't play. Try another version of it.");
          stopLiveStream();
          updateLiveButton();
        }, 0);
      }
    });
    hls.on(window.Hls.Events.ERROR, (_evt, data) => {
      if (!data.fatal || hls !== theaterHls) return;
      if (UNPLAYABLE_ERRORS.includes(data.details)) {
        toast("This channel's video format isn't supported by your browser");
        stopLiveStream();
        return;
      }
      if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && s.mediaRecoveries < 2) {
        s.mediaRecoveries += 1;
        hls.recoverMediaError();
        return;
      }
      scheduleLiveRestart(data.details);
    });
    hls.loadSource(src);
    hls.attachMedia(v);
  }

  function stopLiveStream() {
    if (liveSession) {
      clearTimeout(liveSession.restartTimer);
      liveSession.restartTimer = null;
      liveSession.stopped = true;
    }
    if (theaterHls) { theaterHls.destroy(); theaterHls = null; }
    const v = el.theaterVideo;
    v.pause();
    v.removeAttribute('src');
    v.load();
  }

  function scheduleLiveRestart(reason) {
    const s = liveSession;
    if (!s || s.restartTimer) return;
    if (s.restarts >= MAX_LIVE_RESTARTS) {
      toast(`Lost connection to ${s.item.name || 'channel'} (${reason}). Press Go live to retry.`);
      stopLiveStream();
      updateLiveButton();
      return;
    }
    const delay = Math.min(500 * 2 ** s.restarts, 8000);
    s.restarts += 1;
    s.restartTimer = setTimeout(() => {
      s.restartTimer = null;
      if (liveSession === s) startLiveStream();
    }, delay);
  }

  function restartLiveNow() {
    const s = liveSession;
    clearTimeout(s.restartTimer);
    s.restartTimer = null;
    s.restarts = 0;
    startLiveStream();
    updateLiveButton();
  }

  // hls.js recovers from most hiccups itself, but if the edge stops producing segments
  // it just keeps waiting. Restart on a fresh edge when playback is frozen while not paused.
  function checkLiveProgress() {
    const s = liveSession;
    if (!s) return;
    const v = el.theaterVideo;
    const now = Date.now();
    if (s.stopped || s.restartTimer || v.paused || v.seeking || v.currentTime !== s.lastTime) {
      s.lastTime = v.currentTime;
      s.lastProgressAt = now;
    } else if (now - s.lastProgressAt > LIVE_STALL_RESTART_MS) {
      s.lastProgressAt = now;
      scheduleLiveRestart('stalled');
    }
    updateLiveButton();
  }

  function playTheaterChannel(item) {
    theaterActiveId = item.stream_id;
    highlightActiveRow();
    el.theaterChannelName.textContent = item.name || '';
    el.theaterView.querySelector('.theater-player-col').scrollTop = 0;

    stopLiveStream();
    liveSession = { item, restarts: 0, mediaRecoveries: 0, restartTimer: null, stopped: false, lastTime: 0, lastProgressAt: Date.now() };
    startLiveStream();
    paintFavButton(el.theaterFavBtn, isFav(item.stream_id));
    updateMuteIcon();
    updateLiveButton();

    renderTheaterEpg(item.stream_id);
  }

  function b64decode(str) {
    if (!str) return '';
    try {
      return decodeURIComponent(escape(window.atob(str)));
    } catch {
      return str;
    }
  }

  // Now-playing card + upcoming schedule under the live player. Uses the full-day
  // listings when the provider has them, otherwise the short now/next pair.
  let theaterEpgKey = '';

  function renderTheaterEpg(streamId) {
    theaterEpgKey = '';
    el.theaterEpg.innerHTML = '';
    el.theaterSchedule.hidden = true;
    const draw = () => { if (streamId === theaterActiveId) updateTheaterEpg(true); };
    draw();
    loadEpg(streamId, 'short', true).then(draw);
    loadEpg(streamId, 'full', true).then(draw);
  }

  function updateTheaterEpg(force) {
    const streamId = theaterActiveId;
    const now = Date.now();
    const listings = epgListings(streamId).filter((l) => l.end > now);
    const current = listings[0] && listings[0].start <= now ? listings[0] : null;
    const key = `${streamId}:${listings.length}:${current ? current.start : ''}`;

    if (!force && key === theaterEpgKey) {
      // Same programme: just move the progress bar along.
      const fill = el.theaterEpg.querySelector('.now-bar i');
      const left = el.theaterEpg.querySelector('.now-left');
      if (current && fill) fill.style.width = `${progressPct(current).toFixed(1)}%`;
      if (current && left) left.textContent = `${fmtDuration((current.end - now) / 1000)} left`;
      return;
    }
    theaterEpgKey = key;

    if (!listings.length) {
      el.theaterEpg.innerHTML = '';
      el.theaterSchedule.hidden = true;
      return;
    }

    el.theaterEpg.innerHTML = '';
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
      el.theaterEpg.appendChild(card);
    }

    const upcoming = listings.filter((l) => l !== current && l.start < now + 24 * 3600e3).slice(0, 40);
    const SCHEDULE_PREVIEW = 6;
    el.theaterSchedule.innerHTML = '';
    el.theaterSchedule.hidden = !upcoming.length;
    if (!upcoming.length) return;
    el.theaterSchedule.insertAdjacentHTML('beforeend', '<h3 class="section-title">Up Next</h3>');
    const dayLabel = (ms) => {
      const d = new Date(ms);
      const today = new Date();
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      if (d.toDateString() === today.toDateString()) return 'Today';
      if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
      return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' });
    };
    let lastDay = dayLabel(now);
    upcoming.forEach((p) => {
      const day = dayLabel(p.start);
      if (day !== lastDay) {
        el.theaterSchedule.insertAdjacentHTML('beforeend', `<div class="schedule-day">${escapeHtml(day)}</div>`);
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
      if (upcoming.indexOf(p) >= SCHEDULE_PREVIEW) row.hidden = true;
      el.theaterSchedule.appendChild(row);
    });
    // Hide day headers whose rows are all collapsed, and offer the rest on demand.
    const syncDays = () => el.theaterSchedule.querySelectorAll('.schedule-day').forEach((d) => {
      const next = d.nextElementSibling;
      d.hidden = !next || next.hidden;
    });
    syncDays();
    if (upcoming.length > SCHEDULE_PREVIEW) {
      const more = document.createElement('button');
      more.className = 'schedule-more';
      more.textContent = 'Show full schedule';
      more.addEventListener('click', () => {
        el.theaterSchedule.querySelectorAll('.schedule-row[hidden]').forEach((r) => { r.hidden = false; });
        syncDays();
        more.remove();
      });
      el.theaterSchedule.appendChild(more);
    }
  }

  // ---------- Init ----------
  tryAutoLogin();
})();
