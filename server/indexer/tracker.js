// Generic (non-BMad) artifacts: any markdown/HTML report a tool or skill wrote into the repo
// (e.g. seo-audit/, security/, BACKLOG.md), plus work items parsed from tracker files.
//
// Docs: every .md in the repo (outside dependency/build folders) and every .html that sits next to one.
// Workstreams: the top-level folder a doc lives in ("seo-audit"), or the root file name ("BACKLOG").
// Trackers: files named like status / todo / backlog / tasks / roadmap / findings / issues / bugs,
//   or with `pmdai: tracker` in frontmatter. Items come from:
//   - checkboxes  (- [ ] / - [x])
//   - table rows under a status heading ("Done", "Still open", "To do", "In progress"...)
//   - sub-headings under a status heading, with their checkboxes as tasks
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { makeDoc } from './bmad.js';

export const DEFAULT_EXCLUDE_DIRS = [
  'node_modules', '.git', 'vendor', 'vendors', 'bower_components', 'assets', 'extensions', 'framework', 'yii',
  'themes', 'ckeditor', 'dist', 'build', 'out', 'backup', 'backups', 'uploads', 'runtime', 'tmp', 'cache',
  '.venv', 'venv', '__pycache__', 'target', '.next', '.nuxt', 'coverage', 'ios', 'android', 'Pods', '.dart_tool',
  '_bmad', '_bmad-output', '.bmad-core', '.claude', '.idea', '.vscode',
];
const TRACKER_NAME = /(^|[-_.\s])(status|todo|to-do|backlog|tasks?|tracker|roadmap|findings|issues|bugs|punch-?list)([-_.\s]|$)/i;
const MAX_DOCS = 400;

const STATUS_HEADINGS = [
  ['done', /\b(done|completed?|finished|fixed|shipped|resolved|closed|delivered)\b/i],
  ['in-progress', /\b(in[- ]progress|doing|wip|ongoing|current(ly)? working|started)\b/i],
  ['review', /\b(in review|review|testing|qa|verify|to verify)\b/i],
  ['ready', /\b(next|up next|ready|planned|this (week|sprint))\b/i],
  ['backlog', /\b(to ?do|todo|open|backlog|pending|remaining|not started|later|ideas?|still open|to fix|issues|findings)\b/i],
];
export function headingStatus(text) {
  for (const [status, re] of STATUS_HEADINGS) if (re.test(text)) return status;
  return null;
}

const slug = (s) => String(s).toLowerCase().replace(/[`*_~[\]()]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
const stripMd = (s) => String(s).replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]*)\*\*/g, '$1').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').trim();
const dateIn = (s) => /\b(20\d\d-\d\d-\d\d)\b/.exec(s)?.[1] || null;

export function workstreamOf(rel) {
  const parts = rel.split(/[\\/]/);
  if (parts.length === 1) return path.basename(parts[0]).replace(/\.(md|html?)$/i, '');
  return parts[0] === 'docs' && parts.length > 2 ? `docs/${parts[1]}` : parts[0];
}
const ACRONYMS = new Set(['seo', 'qa', 'ux', 'ui', 'api', 'prd', 'ops', 'ci', 'cd', 'db', 'sql', 'aws', 'gcp', 'vm']);
export const workstreamLabel = (ws) => {
  let s = ws.replace(/^docs\//, '').replace(/[-_]+/g, ' ').trim();
  s = /^[A-Z0-9 ]+$/.test(s) ? s.charAt(0) + s.slice(1).toLowerCase() : s.charAt(0).toUpperCase() + s.slice(1);
  return s.split(' ').map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w)).join(' ');
};
const kindFor = (ws) => (/seo/i.test(ws) ? 'seo' : /secur/i.test(ws) ? 'security' : /bug/i.test(ws) ? 'bug' : /test|qa/i.test(ws) ? 'test' : 'task');

function walk(root, excludeDirs, depth = 0, rel = '', out = []) {
  if (depth > 5 || out.length > MAX_DOCS * 3) return out;
  let entries;
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') && e.name !== '.pmdai') continue;
    const r = rel ? path.join(rel, e.name) : e.name;
    if (e.isDirectory()) {
      if (excludeDirs.includes(e.name) || (e.name === 'items' && rel === '.pmdai') || (e.name === 'stories' && rel === 'docs')) continue;
      walk(root, excludeDirs, depth + 1, r, out);
    } else if (e.isFile() && /\.(md|html?)$/i.test(e.name) && !/^(CODE_OF_CONDUCT|LICENSE)/i.test(e.name)) {
      out.push(r);
    }
  }
  return out;
}

/** Parse one tracker markdown file into items. Exported for tests. */
export function parseTracker(content, { workstream, file, fallbackDate = null } = {}) {
  const lines = content.split(/\r?\n/);
  const items = [];
  const kind = kindFor(workstream || '');
  const stack = []; // headings: { level, text, status }
  let current = null; // heading item collecting checkbox tasks
  let table = null; // { headers, statusCtx }
  let inCode = false;
  // nearest status heading above; a "plain" heading (Current status, Notes...) blocks inheritance
  const ctxHeading = () => { const h = [...stack].reverse().find((x) => x.status); return h && h.status !== 'none' ? h : null; };
  const ctxStatus = () => ctxHeading()?.status || null;
  const push = (it) => {
    const base = `${slug(workstream)}:${slug(it.title)}`;
    let id = base; let n = 2;
    while (items.some((x) => x.id === id)) id = `${base}-${n++}`;
    items.push({
      id, file, workstream, kind, epic: null, storyNum: null, estimate: null, warranty: false,
      type: null, created: null, updated: null, tasksTotal: 0, tasksDone: 0, priority: null, note: null, ...it,
      doneAt: it.status === 'done' ? (it.date ? new Date(it.date).toISOString() : fallbackDate) : null,
    });
    return items[items.length - 1];
  };

  for (const raw of lines) {
    if (/^\s*```/.test(raw)) { inCode = !inCode; continue; }
    if (inCode) continue;
    const h = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(raw);
    if (h) {
      table = null;
      const level = h[1].length;
      const text = stripMd(h[2]);
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      const parentStatus = ctxStatus();
      const own = headingStatus(text);
      // A heading below a status heading is itself a work item ("### Add Mailpit (2026-10-09)")
      const plain = /^(current )?(status|overview|summary|notes?|context|introduction|legend|how to|about)\b/i.test(text);
      if (parentStatus && !own && !plain && level > (ctxHeading()?.level || 0)) {
        current = push({ title: text.replace(/\s*\(20\d\d-\d\d-\d\d\)\s*$/, ''), status: parentStatus, rawStatus: ctxHeading().text, date: dateIn(text), source: 'heading' });
        stack.push({ level, text, status: null, item: current });
      } else {
        current = null;
        stack.push({ level, text, status: own || (plain && parentStatus ? 'none' : null) });
      }
      continue;
    }

    const cb = /^\s*[-*+]\s+\[( |x|X)\]\s+(.+)$/.exec(raw);
    if (cb) {
      const checked = cb[1].toLowerCase() === 'x';
      if (current) { current.tasksTotal++; if (checked) current.tasksDone++; continue; }
      const text = stripMd(cb[2]);
      push({ title: text.length > 160 ? text.slice(0, 157) + '…' : text, status: checked ? 'done' : (ctxStatus() === 'in-progress' ? 'in-progress' : 'backlog'), rawStatus: checked ? '[x]' : '[ ]', date: dateIn(text), source: 'checkbox' });
      continue;
    }

    const row = /^\s*\|(.+)\|\s*$/.exec(raw);
    if (row) {
      const cells = row[1].split('|').map((c) => c.trim());
      if (!table) { table = { headers: cells.map((c) => stripMd(c).toLowerCase()), sep: false }; continue; }
      if (!table.sep && cells.every((c) => /^:?-{2,}:?$/.test(c))) { table.sep = true; continue; }
      const status = ctxStatus();
      if (!status || current) continue; // tables outside status sections are just content
      const col = (re) => table.headers.findIndex((x) => re.test(x));
      const statusCol = col(/^(status|state)$/);
      const prioCol = col(/severity|priority|impact/);
      const noteCol = col(/^(notes?|fix|commit|comment)$/);
      const title = stripMd(cells[0] || '');
      if (!title) continue;
      const rowStatus = statusCol >= 0 ? (headingStatus(cells[statusCol]) || status) : status;
      push({
        title: title.length > 160 ? title.slice(0, 157) + '…' : title,
        status: rowStatus, rawStatus: statusCol >= 0 ? stripMd(cells[statusCol]) : ctxHeading().text,
        priority: prioCol >= 0 ? stripMd(cells[prioCol]) : null,
        note: noteCol >= 0 ? stripMd(cells[noteCol]) : null,
        date: dateIn(cells.join(' ')), source: 'table',
      });
      continue;
    }
    if (raw.trim() === '') continue;
    table = null;
  }
  // Heading items: derive status from their checkboxes when they have any
  for (const it of items) {
    if (it.source === 'heading' && it.tasksTotal > 0 && it.status !== 'done' && it.tasksDone === it.tasksTotal) it.status = 'done';
  }
  return items;
}

export function isTracker(rel, fm = {}) {
  if (fm.pmdai === 'tracker' || fm.tracker === true) return true;
  if (/changelog|history/i.test(rel)) return false;
  return TRACKER_NAME.test(path.basename(rel).replace(/\.md$/i, ''));
}

/** Docs + tracker items + workstream summary for any repo. */
export function indexGeneric(root, { excludeDirs = DEFAULT_EXCLUDE_DIRS } = {}) {
  const files = walk(root, excludeDirs);
  const mdDirs = new Set(files.filter((f) => /\.md$/i.test(f)).map((f) => path.dirname(f)));
  const docs = [];
  const items = [];
  for (const rel of files) {
    const isHtml = /\.html?$/i.test(rel);
    if (isHtml && !mdDirs.has(path.dirname(rel))) continue; // site templates, not reports
    if (docs.length >= MAX_DOCS) break;
    const ws = workstreamOf(rel);
    const full = path.join(root, rel);
    const doc = makeDoc(root, full, path.dirname(rel) === '.' ? 'Repo' : workstreamLabel(ws));
    doc.workstream = path.dirname(rel) === '.' ? null : ws;
    doc.format = isHtml ? 'html' : 'md';
    if (isHtml) {
      try { doc.title = /<title>([^<]+)<\/title>/i.exec(fs.readFileSync(full, 'utf8').slice(0, 4000))?.[1]?.trim() || doc.title; } catch {}
    }
    docs.push(doc);
    if (isHtml) continue;
    let md;
    try { md = matter(fs.readFileSync(full, 'utf8')); } catch { continue; }
    if (!isTracker(rel, md.data)) continue;
    doc.tracker = true;
    const st = fs.statSync(full);
    const found = parseTracker(md.content, { workstream: ws, file: rel, fallbackDate: st.mtime.toISOString() });
    for (const it of found) { it.updated = st.mtime.toISOString(); it.created = it.created || null; }
    items.push(...found);
  }
  // Workstreams = folders (or root tracker files) that hold docs or items
  const wsMap = new Map();
  // A folder is a workstream when it holds a tracker, an HTML report, or non-README docs directly inside it
  // (e.g. seo-audit/). Folders with only a README (frontend/, deploy/) are just docs.
  const isArtifact = (d) => d.tracker || d.format === 'html' || (!/^readme/i.test(path.basename(d.path)) && path.dirname(d.path).split(/[\\/]/).length === (d.workstream.startsWith('docs/') ? 2 : 1));
  const wsWithArtifacts = new Set(docs.filter((d) => d.workstream && isArtifact(d)).map((d) => d.workstream));
  for (const d of docs) if (d.workstream && !wsWithArtifacts.has(d.workstream)) d.workstream = null;
  for (const d of docs) if (d.workstream) {
    const w = wsMap.get(d.workstream) || { id: d.workstream, label: workstreamLabel(d.workstream), docs: 0, updated: null };
    w.docs++; if (!w.updated || d.updated > w.updated) w.updated = d.updated;
    wsMap.set(d.workstream, w);
  }
  for (const it of items) if (!wsMap.has(it.workstream)) wsMap.set(it.workstream, { id: it.workstream, label: workstreamLabel(it.workstream), docs: 0, updated: it.updated });
  return { docs, items, workstreams: [...wsMap.values()] };
}
