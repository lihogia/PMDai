import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTracker, headingStatus, isTracker, workstreamOf, trackerSection } from '../indexer/tracker.js';

const status = `# SEO audit: status of fixes

Tracks the findings. Last updated 14 Nov 2026.

## Done

| Finding | Fix | Commit |
|---|---|---|
| Canonical hardcoded to \`/\` on every page | Each page gives its own URL | \`6f47b8a\` |
| No hreflang | hreflang en/ru/vi | \`6f47b8a\` |

## To do at deploy

- [ ] Confirm \`HOST_URL\` on production
- [x] Delete adminer from the web root

## Still open

| Finding | Severity | Notes |
|---|---|---|
| Rooms only exist as AJAX pop-ups | High | Needs real room pages |
| Large images | Medium | WebP |
`;

const backlog = `# Backlog

## Current status (2026-11-02)

| Service | State |
| --- | --- |
| traefik | Up |

## Done

### Add Mailpit for test email (2026-10-09)

- [x] mailpit service
- [x] docs

## Planned

### Watchdog for Rundeck callbacks

- [ ] alert when a job never calls back
- [x] design
`;

test('heading status keywords', () => {
  assert.equal(headingStatus('Done'), 'done');
  assert.equal(headingStatus('To do at deploy'), 'backlog');
  assert.equal(headingStatus('Still open'), 'backlog');
  assert.equal(headingStatus('In progress'), 'in-progress');
  assert.equal(headingStatus('Current status (2026-11-02)'), null);
});

test('status.md: tables under status headings and checkboxes become items', () => {
  const items = parseTracker(status, { workstream: 'seo-audit', file: 'seo-audit/status.md' });
  assert.equal(items.length, 6);
  assert.equal(items.filter((i) => i.status === 'done').length, 3);
  const rooms = items.find((i) => i.title.startsWith('Rooms'));
  assert.equal(rooms.status, 'backlog');
  assert.equal(rooms.priority, 'High');
  assert.equal(rooms.kind, 'seo');
  assert.equal(items[0].title, 'Canonical hardcoded to / on every page');
  assert.equal(items[0].note, 'Each page gives its own URL');
});

test('BACKLOG.md: sub-headings are items, checkboxes are their tasks', () => {
  const items = parseTracker(backlog, { workstream: 'BACKLOG', file: 'BACKLOG.md' });
  assert.deepEqual(items.map((i) => [i.title, i.status, i.tasksDone, i.tasksTotal]), [
    ['Add Mailpit for test email', 'done', 2, 2],
    ['Watchdog for Rundeck callbacks', 'ready', 1, 2],
  ]);
  assert.ok(items[0].doneAt.startsWith('2026-10-09'));
});

test('tracker file detection and workstreams', () => {
  assert.ok(isTracker('seo-audit/status.md'));
  assert.ok(isTracker('BACKLOG.md'));
  assert.ok(isTracker('TASKS-20260401.md'));
  assert.ok(!isTracker('seo-audit/seo-audit-2026-11-13.md'));
  assert.ok(!isTracker('CHANGELOG.md'));
  assert.ok(isTracker('notes.md', { pmdai: 'tracker' }));
  assert.equal(workstreamOf('seo-audit/status.md'), 'seo-audit');
  assert.equal(workstreamOf('BACKLOG.md'), 'BACKLOG');
});

test('item section: a heading item gets its section, a row or checkbox its own line', () => {
  const items = parseTracker(backlog, { workstream: 'BACKLOG' });
  const mailpit = items.find((i) => /Mailpit/.test(i.title));
  assert.equal(trackerSection(backlog, mailpit), '### Add Mailpit for test email (2026-10-09)\n\n- [x] mailpit service\n- [x] docs');
  const row = parseTracker(status, { workstream: 'seo-audit' }).find((i) => i.source === 'table');
  assert.equal(trackerSection(status, row), '| Finding | Fix | Commit |\n|---|---|---|\n| Canonical hardcoded to `/` on every page | Each page gives its own URL | `6f47b8a` |');
  assert.equal(trackerSection(status, { source: 'table', line: 999 }), null);
});
