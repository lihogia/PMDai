import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assignShortIds, defaultAbbreviation } from '../indexer/ids.js';
import { summarizeSessions } from '../indexer/claude.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pmdai-ids-'));
const saved = (root) => JSON.parse(fs.readFileSync(path.join(root, '.pmdai', 'ids.json'), 'utf8'));

test('default abbreviation', () => {
  assert.equal(defaultAbbreviation('PMDai'), 'PMD');
  assert.equal(defaultAbbreviation('claude-howto'), 'CH');
  assert.equal(defaultAbbreviation('ontrack'), 'ONT');
});

test('stories derive IDs; other items are numbered per type, oldest first, and keep their numbers', () => {
  const root = tmp();
  const items = () => [
    { id: '2-3-login', kind: 'story', epic: 2, storyNum: '2.3' },
    { id: 'crash', kind: 'bug', created: '2026-11-02' },
    { id: 'typo', kind: 'bug', created: '2026-11-01' },
    { id: 'footer', kind: 'backlog' },
  ];
  const first = items();
  assignShortIds(root, first, 'PMD');

  assert.deepEqual(first.map((i) => i.shortId), ['PMD-E2-3', 'PMD-BUG-2', 'PMD-BUG-1', 'PMD-BL-1']);
  assert.deepEqual(saved(root), { typo: 'BUG-1', crash: 'BUG-2', footer: 'BL-1' });

  // "typo" is gone and a new bug appears: numbers are never reused; a new prefix renames everything
  const next = [...items().filter((i) => i.id !== 'typo'), { id: 'leak', kind: 'bug' }];
  assignShortIds(root, next, 'PM');
  assert.deepEqual(next.map((i) => i.shortId), ['PM-E2-3', 'PM-BUG-2', 'PM-BL-1', 'PM-BUG-3']);
});

test('a story split over several spec files: the sprint-status one keeps the plain ID', () => {
  const its = [
    { id: '5-6-send-reporting', kind: 'story', epic: 5, storyNum: '5.6' },
    { id: '5-6-foundational', kind: 'story', epic: 5, storyNum: '5.6', sprintKey: '5-6-launch' },
    { id: '5-6-dispatch', kind: 'story', epic: 5, storyNum: '5.6' },
  ];
  assignShortIds(tmp(), its, 'EMC');
  assert.deepEqual(its.map((i) => i.shortId), ['EMC-E5-6c', 'EMC-E5-6', 'EMC-E5-6b']);
});

test('a session that names a short ID is linked to that item, exactly', () => {
  const session = (text) => ({ id: 's', timestamps: [0, 60000], mentions: Object.fromEntries([...text.matchAll(/\S+/g)].map((m) => [m[0], 1])), usage: {}, paths: {}, userText: '', models: [] });
  const opts = {
    idleMinutes: 10, pricing: {}, itemIds: ['crash', 'leak'],
    aliases: new Map([['pmd-bug-1', 'crash'], ['pmd-bug-12', 'leak']]),
  };
  assert.equal(summarizeSessions([session('pmd-bug-12')], opts)[0].itemId, 'leak');
  assert.equal(summarizeSessions([session('pmd-bug-1')], opts)[0].itemId, 'crash');
  assert.equal(summarizeSessions([session('pmd-bug-123')], opts)[0].itemId, null);
});

test('code edits go to the last known item named before them; unknown IDs do not take the focus', () => {
  const s = {
    id: 's', timestamps: [0, 60000], mentions: { 'pmd-bl-1': 2, 'pmd-bug-99': 1, 'pmd-bl-2': 2 }, usage: {}, paths: {}, userText: '', models: [],
    activity: { 'pmd-bl-1': { mentions: 2, at: 't1' }, 'pmd-bug-99': { mentions: 1, at: 't2' }, 'pmd-bl-2': { mentions: 2, at: 't3' } },
    trail: [{ m: 'pmd-bl-1' }, { e: 2, at: 't2' }, { m: 'pmd-bug-99' }, { e: 1, at: 't3' }, { m: 'pmd-bl-2' }],
  };
  const [out] = summarizeSessions([s], { idleMinutes: 10, pricing: {}, itemIds: ['one', 'two'], aliases: new Map([['pmd-bl-1', 'one'], ['pmd-bl-2', 'two']]) });
  assert.equal(out.itemActivity.one.edits, 3); // pmd-bug-99 is no item: the focus stays on PMD-BL-1
  assert.equal(out.itemActivity.two.edits, 0);
});
