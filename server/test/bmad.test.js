import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { indexBmad } from '../indexer/bmad.js';

const write = (root, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
};

test('BMad output HTML files are docs, with <title> or folder name as title', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pmdai-bmad-'));
  write(root, '_bmad-output/planning-artifacts/prd.md', '# PRD\n');
  write(root, '_bmad-output/planning-artifacts/ux/mockups/dashboard.html', '<html><title>Dashboard mockup</title></html>');
  write(root, '_bmad-output/implementation-artifacts/logo-options/index.html', '<html><body>logos</body></html>');
  write(root, '_bmad-output/implementation-artifacts/spec-1-1-login.md', '---\nstatus: done\n---\n# Login\n');

  const { docs } = indexBmad(root);
  const byPath = Object.fromEntries(docs.map((d) => [d.path, d]));
  assert.equal(byPath['_bmad-output/planning-artifacts/prd.md'].format, 'md');
  assert.equal(byPath['_bmad-output/planning-artifacts/ux/mockups/dashboard.html'].title, 'Dashboard mockup');
  assert.equal(byPath['_bmad-output/planning-artifacts/ux/mockups/dashboard.html'].format, 'html');
  assert.equal(byPath['_bmad-output/implementation-artifacts/logo-options/index.html'].title, 'logo-options');
  assert.equal(byPath['_bmad-output/implementation-artifacts/spec-1-1-login.md'], undefined); // specs are items, not docs
  fs.rmSync(root, { recursive: true, force: true });
});
