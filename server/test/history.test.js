import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trackItems } from '../indexer/history.js';

test('first run takes added times from the items\' own dates, not from now or a shared file time', () => {
  const saved = {};
  const items = [{ id: 'a', status: 'backlog', created: '2026-10-01T00:00:00.000Z' }, { id: 'b', status: 'done', updated: '2026-11-02T00:00:00.000Z' }];
  assert.equal(trackItems(saved, items, '2026-11-17T10:00:00.000Z'), true);
  assert.deepEqual(items.map((i) => [i.firstSeen, i.statusChangedAt]), [['2026-10-01T00:00:00.000Z', null], [null, null]]);
  assert.equal(trackItems(saved, items, '2026-11-17T11:00:00.000Z'), false); // nothing changed, nothing to save
  // later, a new tracker line: the file's time
  const added = [{ id: 'c', status: 'backlog', updated: '2026-11-17T10:30:00.000Z' }];
  trackItems(saved, added, '2026-11-17T11:00:00.000Z');
  assert.equal(added[0].firstSeen, '2026-11-17T10:30:00.000Z');
});

test('a status change records when it happened and what it was', () => {
  const saved = { a: { status: 'backlog', firstSeen: '2026-10-01T00:00:00.000Z', changedAt: null, from: null } };
  // the file changed at 09:00, after the status we had: that's the change time
  const edited = [{ id: 'a', status: 'done', updated: '2026-11-17T09:00:00.000Z' }];
  trackItems(saved, edited, '2026-11-17T10:00:00.000Z');
  assert.deepEqual([edited[0].prevStatus, edited[0].statusChangedAt], ['backlog', '2026-11-17T09:00:00.000Z']);
  // no newer file or session time: the moment PMDai noticed
  const derived = [{ id: 'a', status: 'in-progress', updated: '2026-11-01T00:00:00.000Z' }];
  trackItems(saved, derived, '2026-11-17T12:00:00.000Z');
  assert.deepEqual([derived[0].prevStatus, derived[0].statusChangedAt], ['done', '2026-11-17T12:00:00.000Z']);
});
