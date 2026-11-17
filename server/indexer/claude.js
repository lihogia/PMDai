// Reads Claude Code session transcripts (~/.claude/projects/<encoded-cwd>/<session>.jsonl)
// and turns them into sessions with active time, token usage and item attribution.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { SHORT_ID_RE } from './ids.js';

const cache = new Map(); // file -> { key, session }

// Mentions of BMad artifacts inside a session, used to attribute effort to an item.
const MENTION_RE = /(?:spec-([a-z0-9][a-z0-9._-]*?)\.md)|(?:stories\/([0-9]+\.[0-9]+[a-z0-9._-]*?)\.md)|(?:\.pmdai\/items\/([a-z0-9._-]+?)\.md)|(?:\b(\d+-\d+-[a-z0-9-]{4,})\b)|(?:\b([a-z][a-z0-9]{1,5}-(?:e\d+-\d+[a-z]?|[a-z]{1,6}-\d+))\b)/gi;

const PATH_RE = /(?:^|[\s"'`(=:])((?:[\w.@-]+\/)*[\w.@-]+\/[\w.@-]+\.(?:md|html?|php|js|jsx|ts|tsx|py|css|ya?ml|json|xml|sh))(?=[\s"'`),:\]]|$)/g;

export function modelFamily(model = '') {
  const m = model.toLowerCase();
  if (m.includes('opus') || m.includes('mythos') || m.includes('fable')) return 'opus';
  if (m.includes('haiku')) return 'haiku';
  if (m.includes('sonnet')) return 'sonnet';
  return 'sonnet';
}

export function costOf(usage, pricing) {
  let total = 0;
  for (const [family, u] of Object.entries(usage)) {
    const p = pricing[family] || pricing.sonnet || { input: 0, output: 0, cache_write: 0, cache_read: 0 };
    total += (u.input * p.input + u.output * p.output + u.cacheWrite * (p.cache_write ?? p.input) + u.cacheRead * (p.cache_read ?? 0)) / 1e6;
  }
  return total;
}

/** Active minutes = sum of gaps between consecutive events that are <= idle threshold,
 *  plus one minute per burst so a single quick exchange still counts. */
export function activeMinutes(timestamps, idleMinutes) {
  if (!timestamps.length) return 0;
  const ts = [...timestamps].sort((a, b) => a - b);
  const idle = idleMinutes * 60000;
  let ms = 0;
  let bursts = 1;
  for (let i = 1; i < ts.length; i++) {
    const gap = ts[i] - ts[i - 1];
    if (gap <= idle) ms += gap;
    else bursts++;
  }
  return ms / 60000 + bursts;
}

async function parseSessionFile(file) {
  const stream = fs.createReadStream(file, { encoding: 'utf8' });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const s = {
    id: path.basename(file, '.jsonl'),
    file,
    cwd: null,
    timestamps: [],
    userTurns: 0,
    usage: {}, // family -> {input, output, cacheWrite, cacheRead}
    models: new Set(),
    mentions: {},
    firstPrompt: null,
    userText: '',
    paths: {},
    gitBranch: null,
  };
  const seen = new Set();
  for await (const line of rl) {
    if (!line.trim()) continue;
    let ev;
    try { ev = JSON.parse(line); } catch { continue; }
    if (ev.cwd && !s.cwd) s.cwd = ev.cwd;
    if (ev.gitBranch && !s.gitBranch) s.gitBranch = ev.gitBranch;
    if (ev.timestamp && (ev.type === 'user' || ev.type === 'assistant')) {
      const t = Date.parse(ev.timestamp);
      if (!isNaN(t)) s.timestamps.push(t);
    }
    if (ev.type === 'user' && !ev.isMeta && !ev.toolUseResult) {
      const c = ev.message?.content;
      const text = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((x) => x.type === 'text').map((x) => x.text).join(' ') : '';
      if (text && !text.startsWith('<') && !(Array.isArray(c) && c.some((x) => x.type === 'tool_result'))) {
        s.userTurns++;
        if (!s.firstPrompt) s.firstPrompt = text.slice(0, 200);
        if (s.userText.length < 6000) s.userText += ' ' + text.slice(0, 1500).toLowerCase();
      }
    }
    if (ev.type === 'assistant' && ev.message?.usage) {
      const key = `${ev.message.id || ''}:${ev.requestId || ''}`;
      if (!seen.has(key)) {
        seen.add(key);
        const fam = modelFamily(ev.message.model);
        if (ev.message.model && ev.message.model !== '<synthetic>') s.models.add(ev.message.model);
        const u = (s.usage[fam] ||= { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 });
        const mu = ev.message.usage;
        u.input += mu.input_tokens || 0;
        u.output += mu.output_tokens || 0;
        u.cacheWrite += mu.cache_creation_input_tokens || 0;
        u.cacheRead += mu.cache_read_input_tokens || 0;
      }
    }
    // relative paths of folders/files the session touched, e.g. "seo-audit/status.md"
    for (const m of line.matchAll(PATH_RE)) {
      const p = m[1].toLowerCase();
      s.paths[p] = (s.paths[p] || 0) + 1;
    }
    for (const m of line.matchAll(MENTION_RE)) {
      const id = (m[1] || m[2] || m[3] || m[4] || m[5]).toLowerCase();
      s.mentions[id] = (s.mentions[id] || 0) + 1;
    }
  }
  s.models = [...s.models];
  return s;
}

/** Scan every session file once (cached by mtime+size). */
export async function scanSessions(claudeDir) {
  const projectsDir = path.join(claudeDir, 'projects');
  let dirs = [];
  try { dirs = fs.readdirSync(projectsDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
  const sessions = [];
  for (const d of dirs) {
    const dir = path.join(projectsDir, d.name);
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')); } catch { continue; }
    for (const f of files) {
      const file = path.join(dir, f);
      let st;
      try { st = fs.statSync(file); } catch { continue; }
      const key = `${st.mtimeMs}:${st.size}`;
      const hit = cache.get(file);
      if (hit && hit.key === key) { sessions.push(hit.session); continue; }
      try {
        const session = await parseSessionFile(file);
        if (!session.cwd) session.cwd = decodeDirName(d.name);
        cache.set(file, { key, session });
        sessions.push(session);
      } catch { /* unreadable file */ }
    }
  }
  return sessions;
}

// Best-effort fallback when a transcript has no cwd: "-Users-me-_projects-x" -> "/Users/me/_projects/x"
function decodeDirName(name) {
  return name.replace(/-/g, '/');
}

/** Sessions that ran inside `root` (or a subfolder of it). */
export function sessionsForProject(all, root) {
  const r = path.resolve(root);
  return all.filter((s) => s.cwd && (path.resolve(s.cwd) === r || path.resolve(s.cwd).startsWith(r + path.sep)));
}

/** Summarize sessions for one project: active time, cost, attribution to known item ids. */
export function summarizeSessions(sessions, { idleMinutes, pricing, itemIds, aliases = new Map(), root = '', workstreams = [], itemWorkstream = {} }) {
  const rootL = root.toLowerCase();
  const wsMatch = (s) => {
    const score = {};
    for (const [p, n] of Object.entries(s.paths)) {
      const rel = p.startsWith(rootL + '/') ? p.slice(rootL.length + 1) : p;
      for (const w of workstreams) {
        const wl = w.toLowerCase();
        if (rel.startsWith(wl + '/') || rel.includes('/' + wl + '/') || rel === wl + '.md') score[w] = (score[w] || 0) + n;
      }
    }
    for (const w of workstreams) {
      const words = w.toLowerCase().replace(/^docs\//, '').replace(/[-_]+/g, ' ');
      if (words.length >= 3 && (s.userText.includes(words) || s.userText.includes(w.toLowerCase()))) score[w] = (score[w] || 0) + 5;
    }
    return Object.entries(score).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  };
  const known = new Set(itemIds.map((i) => i.toLowerCase()));
  const resolveItem = (mention) => {
    if (aliases.has(mention)) return aliases.get(mention); // sprint keys, short IDs (PMD-BUG-4)
    if (known.has(mention)) return mention;
    if (SHORT_ID_RE.test(mention)) return null; // exact only: PMD-BUG-1 must not match PMD-BUG-12
    // sprint keys can be truncated; match on prefix like "5-6-launch-validate"
    for (const id of known) if (id.startsWith(mention) || mention.startsWith(id)) return id;
    return null;
  };
  return sessions
    .filter((s) => s.timestamps.length)
    .map((s) => {
      const start = Math.min(...s.timestamps);
      const end = Math.max(...s.timestamps);
      const counts = {};
      for (const [m, n] of Object.entries(s.mentions)) {
        const id = resolveItem(m);
        if (id) counts[id] = (counts[id] || 0) + n;
      }
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const tokens = Object.values(s.usage).reduce((a, u) => a + u.input + u.output + u.cacheWrite + u.cacheRead, 0);
      return {
        id: s.id,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        activeMinutes: Math.round(activeMinutes(s.timestamps, idleMinutes) * 10) / 10,
        wallMinutes: Math.round((end - start) / 60000),
        userTurns: s.userTurns,
        tokens,
        usage: s.usage,
        cost: Math.round(costOf(s.usage, pricing) * 100) / 100,
        models: s.models,
        itemId: ranked[0]?.[0] || null,
        workstream: (ranked[0] && itemWorkstream[ranked[0][0].toLowerCase()]) || wsMatch(s),
        relatedItems: ranked.slice(0, 5).map(([id, n]) => ({ id, mentions: n })),
        firstPrompt: s.firstPrompt,
        gitBranch: s.gitBranch,
        cwd: s.cwd,
      };
    })
    .sort((a, b) => b.start.localeCompare(a.start));
}
