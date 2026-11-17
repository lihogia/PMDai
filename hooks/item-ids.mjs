#!/usr/bin/env node
// Claude Code hook: gets Claude to name PMDai item IDs (PMD-BUG-4), so PMDai can link sessions to items.
//   item-ids.mjs session  (SessionStart)      adds the project's open items and their IDs, once per session
//   item-ids.mjs prompt   (UserPromptSubmit)  when a prompt names no ID, adds a one-line reminder
// Only acts in projects PMDai indexes. Never blocks a prompt: any error just means no output.
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { Index } from '../server/indexer/index.js';
import { indexBmad } from '../server/indexer/bmad.js';
import { indexGeneric, DEFAULT_EXCLUDE_DIRS } from '../server/indexer/tracker.js';
import { assignShortIds, defaultAbbreviation } from '../server/indexer/ids.js';
import { readSettings } from '../server/settings.js';

const MAX_LISTED = 30;
const RANK = { 'in-progress': 0, review: 1, ready: 2, backlog: 3 };

async function readStdin() {
  let s = '';
  for await (const chunk of process.stdin) s += chunk;
  return JSON.parse(s || '{}');
}

const out = (event, text) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } }));

async function main() {
  const mode = process.argv[2];
  const input = await readStdin();
  const cwd = path.resolve(input.cwd || process.cwd());
  const config = loadConfig();
  // The deepest PMDai project that contains the working directory
  const root = new Index(config).discover()
    .filter((r) => cwd === r || cwd.startsWith(r + path.sep))
    .sort((a, b) => b.length - a.length)[0];
  if (!root) return;
  const settings = readSettings(root, config.defaults);
  const abbr = settings.abbreviation || defaultAbbreviation(path.basename(root));

  if (mode === 'prompt') {
    const prompt = String(input.prompt || '');
    if (prompt.trim().length < 12 || new RegExp(`\\b${abbr.replace(/[^A-Za-z0-9]/g, '')}-(E\\d+-\\d+[a-z]?|[A-Z]+-\\d+)\\b`, 'i').test(prompt)) return;
    out('UserPromptSubmit', `PMDai: if this prompt works on a tracked item, name its ID (${abbr}-...) once in your reply, e.g. "Working on ${abbr}-BUG-4". The open items were listed at session start. Skip this for unrelated questions.`);
    return;
  }

  const bmad = indexBmad(root);
  const items = [...bmad.items, ...indexGeneric(root, { excludeDirs: [...DEFAULT_EXCLUDE_DIRS, ...(config.docsExclude || [])] }).items];
  assignShortIds(root, items, abbr);
  const open = items.filter((i) => i.status !== 'done')
    .sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9) || String(b.updated || '').localeCompare(String(a.updated || '')));
  if (!open.length) return;
  const lines = open.slice(0, MAX_LISTED).map((i) => `- ${i.shortId} [${i.status}] ${i.title}`);
  if (open.length > MAX_LISTED) lines.push(`- ... and ${open.length - MAX_LISTED} more (see the PMDai dashboard)`);
  out('SessionStart', [
    `PMDai tracks this project's work items. Open items (${open.length}):`,
    ...lines,
    '',
    `When you work on one of these, name its ID once in your reply (e.g. "Working on ${open[0].shortId}"), so PMDai links this session's time and status to it.`,
  ].join('\n'));
}

main().catch(() => {}).finally(() => process.exit(0));
