import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ensureGitignored, addTimeEntry } from '../settings.js';

const repo = (gitignore) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmdai-gi-'));
  if (gitignore != null) fs.writeFileSync(path.join(root, '.gitignore'), gitignore);
  return root;
};
const read = (root) => fs.readFileSync(path.join(root, '.gitignore'), 'utf8');

test('no .gitignore: nothing is created', () => {
  const root = repo(null);
  assert.deepEqual(ensureGitignored(root), []);
  assert.equal(fs.existsSync(path.join(root, '.gitignore')), false);
});

test('adds both entries once, after existing content without a trailing newline', () => {
  const root = repo('node_modules');
  assert.deepEqual(ensureGitignored(root), ['.pmdai/project.yml', '.pmdai/time-entries.json']);
  assert.equal(read(root), 'node_modules\n\n# PMDai (billing settings and time entries)\n.pmdai/project.yml\n.pmdai/time-entries.json\n');
  assert.deepEqual(ensureGitignored(root), []);
});

test('respects lines that already cover PMDai files', () => {
  for (const line of ['.pmdai/', '/.pmdai', '.pmdai/*']) {
    const root = repo(`dist\n${line}\n`);
    assert.deepEqual(ensureGitignored(root), [], line);
    assert.equal(read(root), `dist\n${line}\n`);
  }
  const root = repo('/.pmdai/project.yml\n');
  assert.deepEqual(ensureGitignored(root), ['.pmdai/time-entries.json']);
});

test('logging time in a repo with a .gitignore ignores PMDai files first', () => {
  const root = repo('dist\n');
  addTimeEntry(root, { date: '2026-11-17', minutes: 30 });
  assert.match(read(root), /\.pmdai\/time-entries\.json/);
});
