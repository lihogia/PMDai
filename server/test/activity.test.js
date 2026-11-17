import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyActivity } from '../indexer/index.js';

test('items worked on in recent Claude sessions move to in progress', () => {
  const items = [
    { id: 'read', status: 'backlog' },
    { id: 'code', status: 'ready' },
    { id: 'review', status: 'review' },
    { id: 'shipped', status: 'done' },
    { id: 'old', status: 'backlog' },
    { id: 'listed', status: 'backlog' },
  ];
  const act = (mentions, edits, at) => ({ mentions, edits, at });
  const sessions = [
    // one long session working through several items
    { end: '2026-11-16T12:00:00Z', itemActivity: {
      read: act(3, 0, '2026-11-16T10:00:00Z'),
      code: act(4, 3, '2026-11-16T11:00:00Z'),
      review: act(2, 1, '2026-11-16T10:00:00Z'),
      shipped: act(5, 2, '2026-11-16T10:00:00Z'),
      listed: act(1, 0, '2026-11-16T10:00:00Z'), // named once, e.g. in git status output
    } },
    { end: '2026-10-01T10:00:00Z', itemActivity: { old: act(9, 5, '2026-10-01T10:00:00Z') } },
  ];
  applyActivity(items, sessions, Date.parse('2026-11-10T00:00:00Z'));
  const by = Object.fromEntries(items.map((i) => [i.id, [i.status, i.activity]]));
  assert.deepEqual(by, {
    read: ['in-progress', 'investigating'],
    code: ['in-progress', 'implementing'],
    review: ['review', 'implementing'],
    shipped: ['done', undefined],
    old: ['backlog', undefined],
    listed: ['backlog', undefined],
  });
  assert.equal(items[1].lastWorkedAt, '2026-11-16T11:00:00Z');
});
