// Reads BMad artifacts (v6 `_bmad-output/`, v4 `docs/stories/`) and PMDai's own
// `.pmdai/items/*.md` into a normalized { epics, items, docs, actionItems } shape.
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import yaml from 'js-yaml';

export const COLUMNS = ['backlog', 'ready', 'in-progress', 'review', 'done'];

const RANK = { backlog: 0, ready: 1, 'in-progress': 2, review: 3, done: 4 };
export const moreAdvanced = (a, b) => (RANK[b] > RANK[a] ? b : a);

export function normalizeStatus(s) {
  const v = String(s || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
  if (!v) return 'backlog';
  if (['done', 'complete', 'completed', 'closed', 'resolved', 'shipped', 'released'].includes(v)) return 'done';
  if (['review', 'in-review', 'qa', 'testing', 'ready-for-review'].includes(v)) return 'review';
  if (['in-progress', 'inprogress', 'doing', 'wip', 'active', 'started'].includes(v)) return 'in-progress';
  if (['ready-for-dev', 'ready', 'approved', 'draft', 'todo', 'to-do', 'planned', 'contexted'].includes(v)) return 'ready';
  return 'backlog';
}

const statSafe = (p) => { try { return fs.statSync(p); } catch { return null; } };
const readSafe = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };

function listMd(dir, { recursive = true, maxDepth = 5, exts = ['.md'] } = {}, depth = 0, out = []) {
  if (depth > maxDepth) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory() && recursive) listMd(full, { recursive, maxDepth, exts }, depth + 1, out);
    else if (e.isFile() && exts.some((x) => e.name.toLowerCase().endsWith(x))) out.push(full);
  }
  return out;
}

function parseMd(file) {
  const raw = readSafe(file);
  if (raw == null) return null;
  try { return matter(raw); } catch { return { data: {}, content: raw }; }
}

function firstHeading(content) {
  const m = /^#{1,3}\s+(.+)$/m.exec(content || '');
  return m ? m[1].trim() : null;
}

function toDate(v) {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return isNaN(d) ? null : d.toISOString();
}

function numberOrNull(v) {
  const n = Number(v);
  return v === undefined || v === null || v === '' || isNaN(n) ? null : n;
}

/** Classify a BMad v6 implementation-artifact spec file. */
function classifySpec(base, fm) {
  const type = String(fm.type || '').toLowerCase();
  const story = /^spec-(\d+)-(\d+)-/.exec(base);
  if (type === 'bugfix' || type === 'bug') return { kind: 'bug' };
  if (story) return { kind: 'story', epic: Number(story[1]), storyNum: `${story[1]}.${story[2]}` };
  if (/^spec-backlog-/.test(base)) return { kind: 'backlog' };
  if (type === 'chore' || type === 'refactor') return { kind: 'task' };
  return { kind: 'task' };
}

function parseEpicsMd(file) {
  const epics = new Map();
  const storyTitles = new Map();
  const raw = readSafe(file);
  if (!raw) return { epics, storyTitles };
  for (const m of raw.matchAll(/^#{2,3}\s+Epic\s+(\d+)\s*[:\-–]\s*(.+)$/gm)) {
    const n = Number(m[1]);
    if (!epics.has(n)) epics.set(n, { number: n, title: m[2].trim() });
  }
  for (const m of raw.matchAll(/^#{3,4}\s+Story\s+(\d+)\.(\d+)\s*[:\-–]\s*(.+)$/gm)) {
    storyTitles.set(`${m[1]}.${m[2]}`, m[3].trim());
  }
  return { epics, storyTitles };
}

function docCategory(rel) {
  const r = rel.toLowerCase();
  if (r.includes('prd')) return 'PRD';
  if (r.includes('architecture')) return 'Architecture';
  if (r.includes('ux')) return 'UX';
  if (r.includes('brief')) return 'Brief';
  if (r.includes('brainstorm')) return 'Brainstorm';
  if (r.includes('epics')) return 'Epics';
  if (r.includes('test')) return 'Testing';
  if (r.includes('retro')) return 'Retro';
  if (r.includes('context')) return 'Context';
  if (r.includes('spec')) return 'Spec';
  if (r.includes('backlog') || r.includes('deferred')) return 'Backlog';
  return 'Other';
}

const isHtmlFile = (f) => /\.html?$/i.test(f);

// HTML title: <title>, else the file name (or its folder's, for index.html)
function htmlTitle(file) {
  const t = /<title>([^<]+)<\/title>/i.exec((readSafe(file) || '').slice(0, 4000))?.[1]?.trim();
  if (t) return t;
  const base = path.basename(file).replace(/\.html?$/i, '');
  return base.toLowerCase() === 'index' ? path.basename(path.dirname(file)) : base;
}

export function makeDoc(root, file, category) {
  const st = statSafe(file);
  const rel = path.relative(root, file);
  const html = isHtmlFile(file);
  const md = html ? null : parseMd(file);
  return {
    id: rel,
    path: rel,
    title: html ? htmlTitle(file) : md?.data?.title || firstHeading(md?.content) || path.basename(file, '.md'),
    category: category || docCategory(rel),
    format: html ? 'html' : 'md',
    updated: st ? st.mtime.toISOString() : null,
    size: st ? st.size : 0,
  };
}

export function detectBmad(root) {
  if (statSafe(path.join(root, '_bmad-output')) || statSafe(path.join(root, '_bmad'))) return 'v6';
  if (statSafe(path.join(root, '.bmad-core')) || statSafe(path.join(root, 'docs', 'stories'))) return 'v4';
  return null;
}

export function indexBmad(root) {
  const version = detectBmad(root);
  const items = [];
  const docs = [];
  const epicMap = new Map();
  let actionItems = [];

  const cleanTitle = (t, storyNum) => (storyNum ? t.replace(/^Story\s+\d+\.\d+\s*(?:[:\-–]\s*)?/i, '') : t);
  const addItemFromMd = (file, defaults = {}) => {
    const md = parseMd(file);
    if (!md) return;
    const fm = md.data || {};
    const st = statSafe(file);
    const base = path.basename(file, '.md');
    const cls = defaults.kind ? defaults : { ...classifySpec(base, fm), ...defaults };
    const rawStatus = fm.status ?? (/^##\s*Status\s*\n+\s*([^\n]+)/m.exec(md.content || '')?.[1]);
    const tasks = [...(md.content || '').matchAll(/^\s*[-*]\s+\[( |x|X)\]/gm)];
    items.push({
      id: base.replace(/^spec-/, ''),
      file: path.relative(root, file),
      title: cleanTitle(String(fm.title || firstHeading(md.content) || base), cls.storyNum),
      kind: fm.kind || cls.kind,
      type: fm.type || null,
      epic: cls.epic ?? numberOrNull(fm.epic),
      storyNum: cls.storyNum || null,
      status: normalizeStatus(rawStatus),
      rawStatus: rawStatus ? String(rawStatus) : null,
      created: toDate(fm.created),
      updated: st ? st.mtime.toISOString() : null,
      doneAt: normalizeStatus(rawStatus) === 'done' ? toDate(fm.completed || fm.done) || (st ? st.mtime.toISOString() : null) : null,
      estimate: numberOrNull(fm.estimate ?? fm.points ?? fm.story_points),
      priority: fm.priority ?? fm.severity ?? null,
      warranty: fm.warranty === true,
      tasksTotal: tasks.length,
      tasksDone: tasks.filter((t) => t[1].toLowerCase() === 'x').length,
    });
  };

  if (version === 'v6') {
    const out = path.join(root, '_bmad-output');
    const impl = path.join(out, 'implementation-artifacts');
    const planning = path.join(out, 'planning-artifacts');

    const { epics, storyTitles } = parseEpicsMd(path.join(planning, 'epics.md'));
    for (const [n, e] of epics) epicMap.set(n, { ...e, status: 'backlog' });

    // Spec files (stories, bugs, backlog items, tasks)
    let implFiles = [];
    try { implFiles = fs.readdirSync(impl).filter((f) => f.endsWith('.md')); } catch {}
    for (const f of implFiles) {
      if (f.startsWith('spec-')) addItemFromMd(path.join(impl, f));
      else docs.push(makeDoc(root, path.join(impl, f)));
    }

    // sprint-status.yaml overrides story status and adds stories that have no spec yet
    const sprintRaw = readSafe(path.join(impl, 'sprint-status.yaml'));
    if (sprintRaw) {
      let sprint = {};
      try { sprint = yaml.load(sprintRaw) || {}; } catch {}
      const dev = sprint.development_status || {};
      for (const [key, status] of Object.entries(dev)) {
        const em = /^epic-(\d+)$/.exec(key);
        if (em) {
          const n = Number(em[1]);
          epicMap.set(n, { number: n, title: epicMap.get(n)?.title || `Epic ${n}`, ...epicMap.get(n), status: normalizeStatus(status), rawStatus: status });
          continue;
        }
        if (/retrospective$/.test(key)) continue;
        const sm = /^(\d+)-(\d+)-(.+)$/.exec(key);
        if (!sm) continue;
        const storyNum = `${sm[1]}.${sm[2]}`;
        const existing = items.find((i) => i.kind === 'story' && i.storyNum === storyNum);
        const norm = normalizeStatus(status);
        if (existing) {
          const merged = moreAdvanced(norm, existing.status);
          if (merged !== existing.status) existing.rawStatus = `${status} (sprint-status)`;
          else if (merged !== norm) existing.rawStatus = `${existing.rawStatus} (spec) / ${status} (sprint-status)`;
          existing.status = merged;
          existing.sprintKey = key;
          if (merged === 'done' && !existing.doneAt) existing.doneAt = existing.updated;
        } else {
          items.push({
            id: key, file: null, sprintKey: key,
            title: storyTitles.get(storyNum) || sm[3].replace(/-/g, ' '),
            kind: 'story', type: 'feature', epic: Number(sm[1]), storyNum,
            status: norm, rawStatus: String(status), created: null, updated: null, doneAt: null,
            estimate: null, warranty: false, tasksTotal: 0, tasksDone: 0,
          });
        }
      }
      actionItems = (sprint.action_items || []).map((a) => ({
        id: a.id, epic: a.epic ?? null, action: a.action, owner: a.owner || null,
        status: normalizeStatus(a.status === 'open' ? 'backlog' : a.status), rawStatus: a.status, ref: a.ref || null,
      }));
    }

    // Planning + other output docs, and HTML anywhere in the output (mockups, walkthroughs, brainstorms)
    for (const f of listMd(out, { exts: ['.md', '.html', '.htm'] })) {
      if (f.startsWith(impl + path.sep) && !isHtmlFile(f)) continue;
      docs.push(makeDoc(root, f));
    }
  } else if (version === 'v4') {
    for (const f of listMd(path.join(root, 'docs', 'stories'), { recursive: false })) {
      const base = path.basename(f, '.md');
      const m = /^(\d+)\.(\d+)/.exec(base);
      addItemFromMd(f, { kind: 'story', epic: m ? Number(m[1]) : null, storyNum: m ? `${m[1]}.${m[2]}` : null });
    }
  }

  // PMDai-native items (bugs, test runs, backlog) - any BMad version or none
  for (const f of listMd(path.join(root, '.pmdai', 'items'))) {
    const md = parseMd(f);
    const k = String(md?.data?.type || 'task').toLowerCase();
    addItemFromMd(f, { kind: ['bug', 'story', 'backlog', 'test'].includes(k) ? k : 'task' });
  }

  // Epic status fallback from stories
  for (const it of items) {
    if (it.epic != null && !epicMap.has(it.epic)) epicMap.set(it.epic, { number: it.epic, title: `Epic ${it.epic}`, status: 'backlog' });
  }
  const epicsOut = [...epicMap.values()].sort((a, b) => a.number - b.number).map((e) => {
    const stories = items.filter((i) => i.epic === e.number && i.kind === 'story');
    const done = stories.filter((s) => s.status === 'done').length;
    const allDone = stories.length > 0 && done === stories.length;
    const doneAt = allDone ? stories.map((s) => s.doneAt).filter(Boolean).sort().pop() || null : null;
    return { ...e, stories: stories.length, storiesDone: done, effectiveStatus: allDone ? 'done' : e.status, doneAt };
  });

  return { version, epics: epicsOut, items, docs, actionItems };
}

/** Read one markdown doc safely (path must stay inside the project). */
export function safePath(root, rel, exts = ['.md']) {
  const full = path.resolve(root, rel);
  if (!full.startsWith(path.resolve(root) + path.sep)) { const e = new Error('Path outside project'); e.status = 400; throw e; }
  if (!exts.some((x) => full.toLowerCase().endsWith(x))) { const e = new Error(`Only ${exts.join(', ')} files`); e.status = 400; throw e; }
  return full;
}

export function readDoc(root, rel) {
  const full = safePath(root, rel);
  const raw = fs.readFileSync(full, 'utf8');
  const md = matter(raw);
  return { path: rel, frontmatter: md.data, content: md.content };
}
