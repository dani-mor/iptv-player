// Views sit on top of each other in browser history so the back button, mouse back
// and Esc all step out one level (watch -> movie -> browse, theater -> browse, ...).

import { $ } from './util.js';

export const TAB_LABELS = { live: 'Live TV', vod: 'Movies', series: 'TV Shows' };
export const HOME_LABEL = 'Home';

export const nav = { view: 'home', type: 'live' };

// Top-level pages, with the tabs and search in the top bar.
export const isTopLevel = (name) => name === 'home' || name === 'browse';

// "Back" label for a page opened from here: Home, or the catalogue tab (`tabLabel`).
export const backTo = (tabLabel) => (nav.view === 'home' ? HOME_LABEL : tabLabel);

const views = {}; // name -> { node, available() }
const listeners = [];

export function registerView(name, node, available = () => true) {
  views[name] = { node, available };
}

// fn(prev, next) runs on every view change, after the DOM switched.
export const onViewChange = (fn) => listeners.push(fn);

export function setView(name, backLabel) {
  const prev = nav.view;
  nav.view = name;
  Object.entries(views).forEach(([n, v]) => { v.node.hidden = n !== name; });

  const browsing = isTopLevel(name);
  $('#back-btn').hidden = browsing;
  $('#brand').hidden = !browsing;
  $('#tabs').style.visibility = browsing ? '' : 'hidden';
  $('.topbar-right').style.visibility = browsing ? '' : 'hidden';
  $('#back-label').textContent = backLabel || TAB_LABELS[nav.type];

  listeners.forEach((fn) => fn(prev, name));
}

export function pushView(name, backLabel) {
  history.pushState({ view: name, back: backLabel }, '');
  setView(name, backLabel);
}

export function initNavigation(isLoggedIn) {
  window.addEventListener('popstate', (e) => {
    if (!isLoggedIn()) return;
    const state = e.state || {};
    let name = state.view || 'home';
    if (!views[name] || !views[name].available()) name = 'home';
    setView(name, state.back);
  });
  $('#back-btn').addEventListener('click', () => history.back());
}
