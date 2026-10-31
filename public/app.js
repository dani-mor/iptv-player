(() => {
  const STORAGE_KEY = 'iptv_player_creds';
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
    tabsNav: $('#tabs'),
    tabs: document.querySelectorAll('.tab-btn'),
    searchBox: $('#search-box'),
    searchAllBtn: $('#search-all-btn'),
    accountInfo: $('#account-info'),
    logoutBtn: $('#logout-btn'),
    mainLayout: $('#main-layout'),
    categoryList: $('#category-list'),
    contentGrid: $('#content-grid'),

    seriesScreen: $('#series-screen'),
    seriesBack: $('#series-back-btn'),
    seriesTitle: $('#series-title'),
    seriesBody: $('#series-body'),

    theaterBackBtn: $('#theater-back-btn'),
    theaterView: $('#theater-view'),
    theaterVideo: $('#theater-video'),
    theaterChannelName: $('#theater-channel-name'),
    theaterEpg: $('#theater-epg'),
    theaterSearch: $('#theater-search'),
    theaterChannelList: $('#theater-channel-list'),
    theaterLiveBtn: $('#theater-live-btn'),
    theaterLiveLabel: $('#theater-live-btn .live-label'),
    theaterMuteBtn: $('#theater-mute-btn'),
    theaterVolume: $('#theater-volume'),

    playerModal: $('#player-modal'),
    playerTitle: $('#player-title'),
    playerClose: $('#player-close-btn'),
    playerError: $('#player-error'),
    video: $('#video-el'),

    toast: $('#toast'),
  };

  let creds = null; // { server, username, password, ua }
  let currentType = 'live';
  let categoriesCache = {}; // type -> [categories]
  let streamsCache = {}; // `${type}:${categoryId}` -> [items]
  let allLoadedForType = {}; // type -> bool
  let allItemsCache = {}; // type -> merged items
  let currentCategoryId = null;
  let currentDisplayed = [];
  let gridObserver = null;

  let modalHls = null;
  let theaterHls = null;
  let theaterRailItems = [];
  let theaterActiveId = null;
  let liveSession = null; // { item, restarts, mediaRecoveries, restartTimer, stopped, lastTime, lastProgressAt }
  let liveWatchdog = null;

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

  function showScreen(name) {
    el.loginScreen.hidden = name !== 'login';
    el.appScreen.hidden = name !== 'app';
    el.seriesScreen.hidden = name !== 'series';
  }

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 3500);
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
    closeTheater();
    localStorage.removeItem(STORAGE_KEY);
    creds = null;
    categoriesCache = {};
    streamsCache = {};
    allLoadedForType = {};
    allItemsCache = {};
    showScreen('login');
  });

  function enterApp(userInfo) {
    el.accountInfo.textContent = formatExpiry(userInfo);
    showScreen('app');
    currentType = 'live';
    el.tabs.forEach((b) => b.classList.toggle('active', b.dataset.type === 'live'));
    loadCategories('live');
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

  el.tabs.forEach((btn) => {
    btn.addEventListener('click', () => {
      closeTheater();
      el.tabs.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      currentType = btn.dataset.type;
      el.searchBox.value = '';
      el.searchAllBtn.classList.remove('active');
      loadCategories(currentType);
    });
  });

  const ACTIONS = {
    live: { categories: 'get_live_categories', streams: 'get_live_streams' },
    vod: { categories: 'get_vod_categories', streams: 'get_vod_streams' },
    series: { categories: 'get_series_categories', streams: 'get_series' },
  };

  async function loadCategories(type) {
    currentCategoryId = null;
    el.categoryList.innerHTML = '<div class="loading-msg">Loading categories…</div>';
    el.contentGrid.innerHTML = '';
    try {
      if (!categoriesCache[type]) {
        categoriesCache[type] = await apiXtream(ACTIONS[type].categories);
      }
      renderCategoryList(type, categoriesCache[type]);
      const first = categoriesCache[type][0];
      if (first) selectCategory(type, first.category_id, first.category_name);
    } catch (err) {
      el.categoryList.innerHTML = `<div class="loading-msg">Failed to load categories</div>`;
      toast(err.message);
    }
  }

  function renderCategoryList(type, categories) {
    el.categoryList.innerHTML = '';
    const allItem = document.createElement('div');
    allItem.className = 'category-item';
    allItem.textContent = 'All (search all)';
    allItem.addEventListener('click', () => loadAllForType(type, true));
    el.categoryList.appendChild(allItem);

    categories.forEach((cat) => {
      const item = document.createElement('div');
      item.className = 'category-item';
      item.textContent = cat.category_name;
      item.dataset.categoryId = cat.category_id;
      item.addEventListener('click', () => selectCategory(type, cat.category_id, cat.category_name));
      el.categoryList.appendChild(item);
    });
  }

  function markActiveCategory(categoryId) {
    el.categoryList.querySelectorAll('.category-item').forEach((n) => {
      n.classList.toggle('active', n.dataset.categoryId === String(categoryId));
    });
  }

  async function selectCategory(type, categoryId, categoryName) {
    currentCategoryId = categoryId;
    markActiveCategory(categoryId);
    el.searchBox.placeholder = `Search in ${categoryName || 'category'}…`;
    const cacheKey = `${type}:${categoryId}`;
    el.contentGrid.innerHTML = '<div class="loading-msg">Loading…</div>';
    try {
      if (!streamsCache[cacheKey]) {
        streamsCache[cacheKey] = await apiXtream(ACTIONS[type].streams, { category_id: categoryId });
      }
      currentDisplayed = streamsCache[cacheKey];
      renderGrid(currentDisplayed, type);
    } catch (err) {
      el.contentGrid.innerHTML = '<div class="loading-msg">Failed to load items</div>';
      toast(err.message);
    }
  }

  async function loadAllForType(type, fromAllClick) {
    if (fromAllClick) {
      el.categoryList.querySelectorAll('.category-item').forEach((n) => n.classList.remove('active'));
      el.categoryList.firstChild.classList.add('active');
    }
    if (allLoadedForType[type]) {
      currentDisplayed = allItemsCache[type];
      applyFilterAndRender(type);
      return;
    }
    el.searchAllBtn.disabled = true;
    el.searchAllBtn.textContent = 'Loading…';
    el.contentGrid.innerHTML = '<div class="loading-msg">Loading all categories, this can take a moment…</div>';
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
      currentDisplayed = results;
      el.searchAllBtn.classList.add('active');
      applyFilterAndRender(type);
      toast(`Loaded ${results.length} items across ${categories.length} categories`);
    } catch (err) {
      toast(err.message);
      el.contentGrid.innerHTML = '<div class="loading-msg">Failed to load all categories</div>';
    } finally {
      el.searchAllBtn.disabled = false;
      el.searchAllBtn.textContent = 'Search all';
    }
  }

  el.searchAllBtn.addEventListener('click', () => loadAllForType(currentType, true));

  function applyFilterAndRender(type) {
    const query = el.searchBox.value.trim().toLowerCase();
    let items = currentDisplayed;
    if (query) {
      items = items.filter((it) => (it.name || '').toLowerCase().includes(query));
    }
    renderGrid(items, type);
  }

  el.searchBox.addEventListener('input', () => applyFilterAndRender(currentType));

  // Renders items in batches as the user scrolls, instead of creating
  // thousands of DOM nodes up front for large VOD/series libraries.
  function renderGrid(items, type) {
    if (gridObserver) {
      gridObserver.disconnect();
      gridObserver = null;
    }
    el.contentGrid.classList.toggle('aspect-wide', type === 'live');
    el.contentGrid.innerHTML = '';

    if (!items.length) {
      el.contentGrid.innerHTML = '<div class="empty-msg">No items found.</div>';
      return;
    }

    const sentinel = document.createElement('div');
    sentinel.className = 'scroll-sentinel';
    el.contentGrid.appendChild(sentinel);

    let rendered = 0;
    function appendBatch() {
      const slice = items.slice(rendered, rendered + BATCH_SIZE);
      const frag = document.createDocumentFragment();
      slice.forEach((item) => frag.appendChild(buildCard(item, type)));
      el.contentGrid.insertBefore(frag, sentinel);
      rendered += slice.length;
      if (rendered >= items.length) {
        gridObserver.disconnect();
        sentinel.remove();
      }
    }

    gridObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) appendBatch();
    }, { root: el.contentGrid, rootMargin: '800px' });

    appendBatch();
    if (rendered < items.length) gridObserver.observe(sentinel);
  }

  function buildCard(item, type) {
    const card = document.createElement('div');
    card.className = 'card';

    const thumb = document.createElement('div');
    thumb.className = `card-thumb ${type === 'live' ? 'aspect-wide' : 'aspect-poster'}`;
    const imgUrl = item.stream_icon || item.cover || item.movie_image || '';
    if (imgUrl) {
      const img = document.createElement('img');
      img.loading = 'lazy';
      img.src = imgUrl;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.onerror = () => { thumb.innerHTML = '<span class="placeholder">▶</span>'; };
      thumb.appendChild(img);
    } else {
      thumb.innerHTML = '<span class="placeholder">▶</span>';
    }

    const title = document.createElement('div');
    title.className = 'card-title';
    title.textContent = item.name || 'Untitled';

    card.appendChild(thumb);
    card.appendChild(title);

    card.addEventListener('click', () => {
      if (type === 'live') openTheater(item);
      else if (type === 'vod') openVodPlayer(item);
      else if (type === 'series') openSeriesDetail(item);
    });

    return card;
  }

  // ---------- Series detail ----------

  el.seriesBack.addEventListener('click', () => showScreen('app'));

  async function openSeriesDetail(item) {
    showScreen('series');
    el.seriesTitle.textContent = item.name || '';
    el.seriesBody.innerHTML = '<div class="loading-msg">Loading episodes…</div>';
    try {
      const info = await apiXtream('get_series_info', { series_id: item.series_id });
      renderSeriesBody(item, info);
    } catch (err) {
      el.seriesBody.innerHTML = '<div class="loading-msg">Failed to load series info</div>';
      toast(err.message);
    }
  }

  function renderSeriesBody(item, info) {
    el.seriesBody.innerHTML = '';
    const episodesBySeason = info.episodes || {};
    const seasonNumbers = Object.keys(episodesBySeason).sort((a, b) => Number(a) - Number(b));

    if (!seasonNumbers.length) {
      el.seriesBody.innerHTML = '<div class="empty-msg">No episodes found for this series.</div>';
      return;
    }

    const select = document.createElement('select');
    select.className = 'season-select';
    seasonNumbers.forEach((num) => {
      const opt = document.createElement('option');
      opt.value = num;
      opt.textContent = `Season ${num}`;
      select.appendChild(opt);
    });

    const list = document.createElement('div');
    list.className = 'episode-list';

    function renderSeason(num) {
      list.innerHTML = '';
      const episodes = (episodesBySeason[num] || []).slice().sort((a, b) => Number(a.episode_num) - Number(b.episode_num));
      episodes.forEach((ep) => {
        const row = document.createElement('div');
        row.className = 'episode-row';
        const epNum = document.createElement('span');
        epNum.className = 'episode-num';
        epNum.textContent = ep.episode_num;
        const textWrap = document.createElement('div');
        const epTitle = document.createElement('div');
        epTitle.className = 'episode-title';
        epTitle.textContent = ep.title || `Episode ${ep.episode_num}`;
        textWrap.appendChild(epTitle);
        if (ep.info && ep.info.plot) {
          const plot = document.createElement('p');
          plot.className = 'episode-plot';
          plot.textContent = ep.info.plot;
          textWrap.appendChild(plot);
        }
        row.appendChild(epNum);
        row.appendChild(textWrap);
        row.addEventListener('click', () => openEpisodePlayer(item, ep));
        list.appendChild(row);
      });
    }

    select.addEventListener('change', () => renderSeason(select.value));
    el.seriesBody.appendChild(select);
    el.seriesBody.appendChild(list);
    renderSeason(seasonNumbers[0]);
  }

  // ---------- Movie / episode player (modal) ----------

  function openPlayer(title, src) {
    el.playerTitle.textContent = title;
    el.playerError.hidden = true;
    el.playerModal.hidden = false;

    if (modalHls) { modalHls.destroy(); modalHls = null; }
    el.video.pause();
    el.video.removeAttribute('src');
    el.video.load();
    el.video.src = src;
    el.video.play().catch(() => {});
  }

  function closePlayer() {
    el.video.pause();
    el.video.removeAttribute('src');
    el.video.load();
    el.playerModal.hidden = true;
  }

  el.playerClose.addEventListener('click', closePlayer);
  el.playerModal.addEventListener('click', (e) => { if (e.target === el.playerModal) closePlayer(); });

  function openVodPlayer(item) {
    const ext = item.container_extension || 'mp4';
    const src = `/stream?${qs({ ...creds, type: 'movie', id: item.stream_id, ext })}`;
    openPlayer(item.name, src);
  }

  function openEpisodePlayer(series, ep) {
    const ext = ep.container_extension || 'mp4';
    const src = `/stream?${qs({ ...creds, type: 'series', id: ep.id, ext })}`;
    openPlayer(`${series.name} — ${ep.title || 'Episode ' + ep.episode_num}`, src);
  }

  // ---------- Live TV theater view ----------

  function setTheaterMode(active) {
    el.mainLayout.hidden = active;
    el.theaterView.hidden = !active;
    el.theaterBackBtn.hidden = !active;
    el.tabsNav.hidden = active;
    el.searchBox.hidden = active;
    el.searchAllBtn.hidden = active;
  }

  function openTheater(item) {
    theaterRailItems = currentDisplayed;
    theaterActiveId = item.stream_id;
    el.theaterSearch.value = '';
    setTheaterMode(true);
    renderChannelRail(theaterRailItems);
    playTheaterChannel(item);
    if (!liveWatchdog) liveWatchdog = setInterval(checkLiveProgress, 1000);
  }

  function closeTheater() {
    if (el.theaterView.hidden) return;
    stopLiveStream();
    liveSession = null;
    clearInterval(liveWatchdog);
    liveWatchdog = null;
    setTheaterMode(false);
  }

  el.theaterBackBtn.addEventListener('click', closeTheater);

  el.theaterSearch.addEventListener('input', () => {
    const query = el.theaterSearch.value.trim().toLowerCase();
    const filtered = query ? theaterRailItems.filter((it) => (it.name || '').toLowerCase().includes(query)) : theaterRailItems;
    renderChannelRail(filtered);
  });

  function updateMuteIcon() {
    const v = el.theaterVideo;
    const isMuted = v.muted || v.volume === 0;
    el.theaterMuteBtn.innerHTML = isMuted ? '&#128263;' : '&#128266;';
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
        img.onerror = () => { logo.innerHTML = '▶'; };
        logo.appendChild(img);
      } else {
        logo.textContent = '▶';
      }

      const name = document.createElement('div');
      name.className = 'ch-name';
      name.textContent = ch.name || 'Untitled';

      row.appendChild(logo);
      row.appendChild(name);
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
    el.theaterEpg.innerHTML = '';

    stopLiveStream();
    liveSession = { item, restarts: 0, mediaRecoveries: 0, restartTimer: null, stopped: false, lastTime: 0, lastProgressAt: Date.now() };
    startLiveStream();
    updateMuteIcon();
    updateLiveButton();

    loadEpg(item.stream_id);
  }

  function b64decode(str) {
    if (!str) return '';
    try {
      return decodeURIComponent(escape(window.atob(str)));
    } catch {
      return str;
    }
  }

  function fmtEpgTime(str) {
    if (!str) return '';
    const m = /(\d{2}:\d{2})(:\d{2})?$/.exec(str.trim());
    return m ? m[1] : str;
  }

  async function loadEpg(streamId) {
    try {
      const data = await apiXtream('get_short_epg', { stream_id: streamId, limit: 2 });
      const listings = (data.epg_listings || []).map((l) => ({
        title: b64decode(l.title),
        description: b64decode(l.description),
        start: l.start,
        end: l.end,
      }));
      if (streamId !== theaterActiveId) return; // channel changed while this was in flight
      if (!listings.length) {
        el.theaterEpg.innerHTML = '';
        return;
      }
      const now = listings[0];
      let html = `<div><span class="epg-time">${escapeHtml(fmtEpgTime(now.start))}–${escapeHtml(fmtEpgTime(now.end))}</span><span class="epg-now">${escapeHtml(now.title)}</span></div>`;
      if (listings[1]) {
        html += `<div class="epg-next">Next: ${escapeHtml(listings[1].title)} at ${escapeHtml(fmtEpgTime(listings[1].start))}</div>`;
      }
      if (now.description) {
        html += `<div class="epg-desc">${escapeHtml(now.description)}</div>`;
      }
      el.theaterEpg.innerHTML = html;
    } catch {
      if (streamId === theaterActiveId) el.theaterEpg.innerHTML = '';
    }
  }

  // ---------- Init ----------
  tryAutoLogin();
})();
