// Home: the startup page. Main match and Sport Center (sports.js), favourite channels
// (or recently watched ones) and Continue Watching for movies and shows.

import { $ } from './util.js';
import { registerView, onViewChange } from './views.js';
import { library, continueEntries } from './library.js';
import { buildCard, buildContinueCard } from './browse.js';
import { initSports, renderSports, tickSports } from './sports.js';

const el = {
  view: $('#home-view'),
  channels: $('#home-channels'),
  channelsTitle: $('#home-channels-title'),
  channelsRow: $('#home-channels-row'),
  movies: $('#home-movies'),
  moviesRow: $('#home-movies-row'),
  shows: $('#home-shows'),
  showsRow: $('#home-shows-row'),
};

function fillRow(section, row, cards) {
  row.innerHTML = '';
  cards.forEach((c) => row.appendChild(c));
  section.hidden = !cards.length;
}

function renderChannels() {
  const favs = library.favs.length > 0;
  const list = favs ? library.favs : library.recents.slice(0, 12);
  el.channelsTitle.textContent = favs ? 'Favourite Channels' : 'Recently Watched';
  fillRow(el.channels, el.channelsRow, list.map((ch) => buildCard(ch, 'live', list)));
}

function renderContinue() {
  fillRow(el.movies, el.moviesRow, continueEntries('movie').map(buildContinueCard));
  fillRow(el.shows, el.showsRow, continueEntries('series').map(buildContinueCard));
  // Side by side only when both are there.
  el.movies.parentElement.classList.toggle('single', el.movies.hidden || el.shows.hidden);
}

// Re-syncs Home with the library (favourites, progress, reminders changed).
export function refreshHome() {
  renderChannels();
  renderContinue();
  renderSports();
}

// Called every 30 s while Home is showing.
export function tickHome() {
  tickSports();
}

export function initHome() {
  registerView('home', el.view);
  initSports();
  onViewChange((prev, next) => { if (next === 'home') refreshHome(); });
}
