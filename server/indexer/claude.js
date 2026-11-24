// Reads Claude Code session transcripts (~/.claude/projects/<encoded-cwd>/<session>.jsonl)
// and turns them into sessions with active time, token usage and item attribution.
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { SHORT_ID_RE } from './ids.js';

const cache = new Map(); // file -> { key, session }

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

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
    codeEdits: 0, // Edit/Write calls on files other than markdown: the session implemented something
    activity: {}, // mention -> { mentions, at }
    trail: [], // in order: { m: mention }, { t: text you or Claude wrote, at } and { e: code edits, at }; resolved later
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
        s.trail.push({ t: text.slice(0, 1000), by: 'user', at: ev.timestamp || null });
      }
    }
    let lineEdits = 0;
    if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
      for (const c of ev.message.content) {
        const file = c.type === 'tool_use' && EDIT_TOOLS.has(c.name) && (c.input?.file_path || c.input?.notebook_path);
        if (file && !/\.md$/i.test(file)) lineEdits++;
        // what Claude says, and commit messages: matched against item titles later
        if (c.type === 'text') s.trail.push({ t: c.text.slice(0, 1000), by: 'claude', at: ev.timestamp || null });
        else if (c.type === 'tool_use' && c.name === 'Bash' && /\bgit commit\b/.test(c.input?.command || '')) {
          s.trail.push({ t: c.input.command.slice(0, 1000), by: 'commit', at: ev.timestamp || null });
        }
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
    if (ev.type === 'attachment') continue; // hook context (e.g. PMDai's own item list), system notes: nobody wrote these
    // The item in focus is the one you or Claude last named; tool output (file listings, git status) doesn't move it
    const focus = ev.type === 'assistant' || (ev.type === 'user' && !(Array.isArray(ev.message?.content) && ev.message.content.some((x) => x.type === 'tool_result')));
    for (const m of line.matchAll(MENTION_RE)) {
      const id = (m[1] || m[2] || m[3] || m[4] || m[5]).toLowerCase();
      s.mentions[id] = (s.mentions[id] || 0) + 1;
      if (focus && s.trail.at(-1)?.m !== id) s.trail.push({ m: id });
      const a = (s.activity[id] ||= { mentions: 0, at: null });
      a.mentions++;
      if (ev.timestamp) a.at = ev.timestamp;
    }
    s.codeEdits += lineEdits;
    if (lineEdits) s.trail.push({ e: lineEdits, at: ev.timestamp || null });
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

const words = (t) => ` ${String(t).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;

/** Item titles that can be recognised in free text: without code, paths or brackets ("Room page improvements"),
 *  at least 2 words and 12 characters, and unique in the project (claude-howto has many "Hands-on Exercises"). */
export function titleIndex(titles) {
  const seen = new Map();
  for (const [id, title] of titles) {
    const phrase = words(String(title).replace(/`[^`]*`|\([^)]*\)|\[[^\]]*\]|<[^>]*>/g, ' '));
    if (phrase.trim().split(' ').length < 2 || phrase.trim().length < 12) continue;
    seen.set(phrase, seen.has(phrase) ? null : id); // null: shared by several items
  }
  return [...seen].filter(([, id]) => id).sort((a, b) => b[0].length - a[0].length); // longest (most specific) first
}

/** Ids of items whose title appears in `text`, most specific first. */
export function matchTitles(index, text) {
  const w = words(text);
  return index.filter(([phrase]) => w.includes(phrase)).map(([, id]) => id);
}

/** Summarize sessions for one project: active time, cost, attribution to known item ids. */
export function summarizeSessions(sessions, { idleMinutes, pricing, itemIds, aliases = new Map(), titles = [], root = '', workstreams = [], itemWorkstream = {} }) {
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
  const byTitle = titleIndex(titles);
  // Titles named in a text. Claude's replies often list or summarise several items: those count for none.
  const titleHits = (t) => {
    const hits = matchTitles(byTitle, t.t);
    return t.by === 'claude' && hits.length > 1 ? [] : hits;
  };
  // per item: mentions, code edits made while it was the item in focus (the last known item you or Claude
  // named before the edit), last time it was touched
  const resolveActivity = (s) => {
    const out = {};
    const touch = (id, at) => { const o = (out[id] ||= { mentions: 0, edits: 0, at: null }); if (at && (!o.at || at > o.at)) o.at = at; return o; };
    for (const [m, a] of Object.entries(s.activity || {})) {
      const id = resolveItem(m);
      if (id) touch(id, a.at).mentions += a.mentions;
    }
    let current = null;
    for (const t of s.trail || []) {
      if (t.m) current = resolveItem(t.m) || current; // an unknown ID (an example, test data) doesn't take the focus
      else if (t.t != null) {
        const hits = titleHits(t);
        for (const id of hits) touch(id, t.at).mentions++;
        if (hits.length === 1) current = hits[0]; // a list of several items is a summary, not a focus
      } else if (current) touch(current, t.at).edits += t.e;
    }
    return out;
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
      const itemActivity = resolveActivity(s);
      // titles named in prompts and replies link the session too
      for (const t of s.trail || []) if (t.t != null) for (const id of titleHits(t)) counts[id] = (counts[id] || 0) + 1;
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      const tokens = Object.values(s.usage).reduce((a, u) => a + u.input + u.output + u.cacheWrite + u.cacheRead, 0);
      return {
        id: s.id,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
        activeMinutes: Math.round(activeMinutes(s.timestamps, idleMinutes) * 10) / 10,
        wallMinutes: Math.round((end - start) / 60000),
        userTurns: s.userTurns,
        codeEdits: s.codeEdits || 0,
        itemActivity,
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
