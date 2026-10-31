// Entry point: login / auto-login, logout, keyboard shortcuts and periodic refresh.

import { $, store, toast } from './util.js';
import { session, doLogin, clearListCache } from './api.js';
import { nav, setView, registerView, onViewChange, initNavigation } from './views.js';
import { loadLibrary, onLibraryChange } from './library.js';
import { resetCatalog } from './catalog.js';
import { resetEpg, tickEpg } from './epg.js';
import { refreshFavButtons } from './channels.js';
import { initGuide } from './guide.js';
import { initBrowse, switchTab, lastTab, refreshBrowse, tickBrowse, focusSearch } from './browse.js';
import { initTheater, closeTheater, theaterVideo, zap, lastChannel, toggleMute, tickTheater, refreshTheaterFav, focusTheaterSearch } from './theater.js';
import { initSeries, resetSeries } from './series.js';
import { initMovies, resetMovies } from './movie.js';
import { initWatch, watchVideo, seekBy, toggleFullscreen } from './watch.js';
import { initMultiview, pickerOpen, closePicker, setAudioIndex } from './multiview.js';

const CREDS_KEY = 'iptv_player_creds';
const DEFAULT_UA = 'IPTVSmartersPlayer';
const userInfoKey = () => `iptv_user_info:${session.creds.username}@${session.creds.server}`;

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
  accountInfo: $('#account-info'),
  logoutBtn: $('#logout-btn'),
};

function showScreen(name) {
  el.loginScreen.hidden = name !== 'login';
  el.appScreen.hidden = name !== 'app';
}

function formatExpiry(userInfo) {
  if (!userInfo) return '';
  if (userInfo.exp_date && !isNaN(Number(userInfo.exp_date))) {
    return `Expires ${new Date(Number(userInfo.exp_date) * 1000).toLocaleDateString()}`;
  }
  return userInfo.status ? `Status: ${userInfo.status}` : '';
}

function setUserInfo(userInfo) {
  session.userInfo = userInfo || null;
  el.accountInfo.textContent = formatExpiry(userInfo);
  if (userInfo) store.set(userInfoKey(), userInfo);
}

function enterApp(userInfo) {
  loadLibrary();
  setUserInfo(userInfo);
  showScreen('app');
  history.replaceState({ view: 'browse' }, '');
  setView('browse');
  switchTab(lastTab());
}

// Leaves the app and forgets everything loaded for this account.
function leaveApp() {
  closeTheater();
  history.replaceState({ view: 'browse' }, '');
  setView('browse');
  session.creds = null;
  session.userInfo = null;
  resetCatalog();
  resetEpg();
  resetSeries();
  resetMovies();
  showScreen('login');
}

function showLoginError(msg) {
  el.loginError.textContent = msg;
  el.loginError.hidden = !msg;
}

el.loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  showLoginError('');
  const candidate = {
    server: el.inServer.value.trim(),
    username: el.inUsername.value.trim(),
    password: el.inPassword.value,
    ua: el.inUa.value.trim() || DEFAULT_UA,
  };
  el.loginBtn.disabled = true;
  el.loginBtn.textContent = 'Connecting…';
  try {
    const data = await doLogin(candidate);
    session.creds = candidate;
    if (el.inRemember.checked) store.set(CREDS_KEY, candidate);
    else store.remove(CREDS_KEY);
    enterApp(data.user_info);
  } catch (err) {
    showLoginError(err.message);
  } finally {
    el.loginBtn.disabled = false;
    el.loginBtn.textContent = 'Connect';
  }
});

el.logoutBtn.addEventListener('click', () => {
  store.remove(CREDS_KEY);
  clearListCache();
  leaveApp();
});

// With saved credentials the app opens straight away (lists come from the local cache)
// and the login is confirmed in the background.
function tryAutoLogin() {
  const stored = store.get(CREDS_KEY);
  if (!stored || !stored.server) {
    showScreen('login');
    return;
  }
  el.inServer.value = stored.server;
  el.inUsername.value = stored.username;
  el.inPassword.value = stored.password;
  el.inUa.value = stored.ua || DEFAULT_UA;
  session.creds = stored;
  enterApp(store.get(userInfoKey()));
  doLogin(stored).then((data) => {
    if (session.creds === stored) setUserInfo(data.user_info);
  }).catch((err) => {
    if (session.creds !== stored) return;
    if (err.status === 401) {
      leaveApp();
      showLoginError(`Saved session expired: ${err.message}`);
    } else {
      toast(`Can't reach your provider right now: ${err.message}`, { duration: 8000 });
    }
  });
}

// ---------- Keyboard ----------

function togglePlay(v) {
  if (v.paused) v.play().catch(() => {}); else v.pause();
}

document.addEventListener('keydown', (e) => {
  if (el.appScreen.hidden) return;
  const t = e.target;
  if (t.closest('input, textarea, select')) {
    if (e.key === 'Escape' && t.type === 'search') {
      if (t.value) { t.value = ''; t.dispatchEvent(new Event('input')); } else t.blur();
      e.preventDefault();
    }
    return;
  }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  // Cards, rows and categories are divs; make Enter / Space click them like buttons.
  if ((e.key === 'Enter' || e.key === ' ') && t.matches('[data-activate]')) {
    e.preventDefault();
    t.click();
    return;
  }
  if (pickerOpen()) {
    if (e.key === 'Escape') closePicker();
    return;
  }
  if (e.key === 'Escape' && nav.view !== 'browse' && !document.fullscreenElement) {
    history.back();
    return;
  }
  if (e.key === '/') {
    e.preventDefault();
    if (nav.view === 'theater') focusTheaterSearch();
    else if (nav.view === 'browse') focusSearch();
    return;
  }

  if (nav.view === 'theater') {
    const v = theaterVideo();
    if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); zap(-1); return; }
    if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); zap(1); return; }
    if (e.key === 'Backspace') { e.preventDefault(); lastChannel(); return; }
    if (t === v) return; // the native controls handle their own keys
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(v); }
    else if (e.key === 'f') toggleFullscreen(v);
    else if (e.key === 'm') toggleMute();
  } else if (nav.view === 'watch') {
    const v = watchVideo();
    if (t === v) return;
    if (e.key === ' ' || e.key === 'k') { e.preventDefault(); togglePlay(v); }
    else if (e.key === 'f') toggleFullscreen(v);
    else if (e.key === 'm') v.muted = !v.muted;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); seekBy(e.key === 'ArrowLeft' ? -10 : 10); }
  } else if (nav.view === 'multiview') {
    if (/^[1-4]$/.test(e.key)) setAudioIndex(Number(e.key) - 1);
    else if (e.key === 'f') toggleFullscreen($('#mv-grid'));
  }
});

// ---------- Init ----------

registerView('browse', $('#browse-view'));
initNavigation(() => !!session.creds);
initBrowse();
initGuide();
initTheater();
initSeries();
initMovies();
initWatch();
initMultiview();

onViewChange((prev, next) => { if (next === 'browse') refreshBrowse(); });
onLibraryChange(() => {
  refreshFavButtons();
  refreshTheaterFav();
  if (nav.view === 'browse') refreshBrowse();
});

setInterval(() => {
  if (el.appScreen.hidden || document.hidden) return;
  tickEpg();
  tickTheater();
  if (nav.view === 'browse') tickBrowse();
}, 30000);

tryAutoLogin();
