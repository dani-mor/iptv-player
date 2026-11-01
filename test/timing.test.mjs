import test from 'node:test';
import assert from 'node:assert/strict';
import { sportsRefreshDue, dueReminder } from '../public/js/timing.js';

const MIN = 60e3;
const NOW = Date.UTC(2026, 10, 1, 19, 0);
const answer = (events, builtAt = NOW - 3600e3) => ({ guide: { builtAt }, events });
const ev = (state, start) => ({ state, start });

test('sports refresh: right away for another account or other settings', () => {
  assert.equal(sportsRefreshDue({ data: answer([]), loadedAt: NOW, current: false }, NOW), true);
});

test('sports refresh: every 20 s while there is no answer or the guide is still building', () => {
  assert.equal(sportsRefreshDue({ data: null, loadedAt: NOW - 10e3, current: true }, NOW), false);
  assert.equal(sportsRefreshDue({ data: null, loadedAt: NOW - 25e3, current: true }, NOW), true);
  assert.equal(sportsRefreshDue({ data: answer([], null), loadedAt: NOW - 25e3, current: true }, NOW), true);
});

test('sports refresh: every minute while live or about to start, else every 10 min', () => {
  const due = (events, age) => sportsRefreshDue({ data: answer(events), loadedAt: NOW - age, current: true }, NOW);
  assert.equal(due([ev('in', NOW - 30 * MIN)], 2 * MIN), true);
  assert.equal(due([ev('pre', NOW + 3 * MIN)], 2 * MIN), true);
  assert.equal(due([ev('pre', NOW + 2 * 3600e3)], 2 * MIN), false);
  assert.equal(due([ev('pre', NOW + 2 * 3600e3)], 11 * MIN), true);
  // An answer that still says "upcoming" after the start is stale: refresh it quickly.
  assert.equal(due([ev('pre', NOW - 20 * MIN)], 2 * MIN), true);
});

test('reminders: 5 min before, again at the start, not once acted on or long over', () => {
  const r = (extra = {}) => ({ id: 'a', title: 'A', start: NOW, shown: '', acted: false, ...extra });
  assert.equal(dueReminder([r()], NOW - 6 * MIN), null);
  assert.deepEqual(dueReminder([r()], NOW - 4 * MIN), { reminder: r(), phase: 'soon', mins: 4 });
  assert.equal(dueReminder([r({ shown: 'soon' })], NOW - 2 * MIN), null);
  assert.equal(dueReminder([r({ shown: 'soon' })], NOW + 1000).phase, 'start');
  assert.equal(dueReminder([r({ shown: 'start' })], NOW + 10 * MIN), null);
  assert.equal(dueReminder([r({ acted: true })], NOW), null);
  // Opened late, the app still shows it while the match is on, but not hours later.
  assert.equal(dueReminder([r()], NOW + 90 * MIN).phase, 'start');
  assert.equal(dueReminder([r()], NOW + 3 * 3600e3), null);
});

test('reminders: the earliest due one first', () => {
  const later = { id: 'b', title: 'B', start: NOW + 2 * MIN, shown: '', acted: false };
  const earlier = { id: 'a', title: 'A', start: NOW + MIN, shown: '', acted: false };
  assert.equal(dueReminder([later, earlier], NOW).reminder.id, 'a');
});
