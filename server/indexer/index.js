// Discovers projects, builds the in-memory index and keeps it fresh with file watchers.
// The index is always rebuildable from files on disk: md files and Claude transcripts are the source of truth.
import fs from 'node:fs';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import chokidar from 'chokidar';
import { indexBmad, detectBmad, COLUMNS } from './bmad.js';
import { indexGeneric, DEFAULT_EXCLUDE_DIRS, workstreamLabel } from './tracker.js';
import { assignShortIds, defaultAbbreviation } from './ids.js';
import { trackHistory } from './history.js';

const ROOT_MARKERS = ['.git', '_bmad', '_bmad-output', '.bmad-core', '.pmdai', 'package.json', 'composer.json', 'pubspec.yaml',
  'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml', 'Makefile', 'docker-compose.yml', 'CLAUDE.md', 'README.md'];
const isProjectRoot = (dir) => ROOT_MARKERS.some((m) => fs.existsSync(path.join(dir, m)));
const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith('.')).map((d) => path.join(dir, d.name)); } catch { return []; } };
import { scanSessions, sessionsForProject, summarizeSessions } from './claude.js';
import { readSettings, readTimeEntries, hasSettings } from '../settings.js';
import { localDate } from '../billing.js';

/** Live status: an open item that Claude sessions worked on since `since` (ms) is in progress, tagged
 *  `implementing` when code was edited while it was the item in focus, else `investigating` (needs 2+ mentions,
 *  so a file listing that names it once doesn't count). Done items stay done. */
export function applyActivity(items, sessions, since) {
  const activity = {};
  for (const s of sessions) {
    for (const [id, x] of Object.entries(s.itemActivity || {})) {
      const at = x.at || s.end;
      if (Date.parse(at) < since || (x.edits === 0 && x.mentions < 2)) continue;
      const a = (activity[id] ||= { kind: 'investigating', at });
      if (x.edits > 0) a.kind = 'implementing';
      if (at > a.at) a.at = at;
    }
  }
  for (const it of items) {
    const a = activity[it.id];
    if (!a || it.status === 'done') continue;
    it.activity = a.kind;
    it.lastWorkedAt = a.at;
    if (it.status === 'backlog' || it.status === 'ready') {
      it.rawStatus = `${it.rawStatus || it.status}; ${a.kind} in Claude`;
      it.status = 'in-progress';
    }
  }
}

export class Index extends EventEmitter {
  constructor(config) {
    super();
    this.config = config;
    this.projects = new Map();
    this.allSessions = [];
    this.lastBuilt = null;
    this.timer = null;
  }

  /** Top-level folders are projects. A folder that is only a container (no repo markers) but holds
   *  repos, like client-x/{website,ops}, yields one project per inner repo. */
  discover() {
    const roots = new Set();
    if (!fs.existsSync(this.config.projectsRoot)) console.warn(`[pmdai] projectsRoot not found: ${this.config.projectsRoot}`);
    for (const dir of subdirs(this.config.projectsRoot)) {
      const name = path.basename(dir);
      if (this.config.exclude.includes(name)) continue;
      const inner = isProjectRoot(dir) ? [] : subdirs(dir).filter((d) => isProjectRoot(d) && !this.config.exclude.includes(`${name}/${path.basename(d)}`));
      if (inner.length) inner.forEach((d) => roots.add(d));
      else roots.add(dir);
    }
    for (const p of this.config.extraProjects) roots.add(p);
    return [...roots];
  }

  projectId(root) {
    const rel = path.relative(this.config.projectsRoot, root);
    return rel && !rel.startsWith('..') ? rel.split(path.sep).join('~') : path.basename(root);
  }

  async rebuild() {
    const started = Date.now();
    this.allSessions = await scanSessions(this.config.claudeDir);
    const next = new Map();
    for (const root of this.discover()) {
      const p = this.buildProject(root);
      next.set(p.id, p);
    }
    this.projects = next;
    this.lastBuilt = new Date().toISOString();
    console.log(`[pmdai] indexed ${next.size} projects, ${this.allSessions.length} Claude sessions in ${Date.now() - started} ms`);
    this.emit('changed', { at: this.lastBuilt });
  }

  buildProject(root) {
    const id = this.projectId(root);
    const settings = readSettings(root, this.config.defaults);
    const bmad = indexBmad(root);
    const generic = indexGeneric(root, {
      excludeDirs: [...DEFAULT_EXCLUDE_DIRS, ...(this.config.docsExclude || [])],
      since: new Date(Date.now() - this.config.justChangedHours * 3600000).toISOString(),
    });
    // Merge: BMad items/docs plus every other report and tracker in the repo
    bmad.items.push(...generic.items);
    const seen = new Set(bmad.docs.map((d) => d.path));
    for (const d of generic.docs) if (!seen.has(d.path)) bmad.docs.push(d);
    for (const d of bmad.docs) { d.format ||= 'md'; d.workstream ||= bmad.version ? 'bmad' : null; }
    const workstreams = generic.workstreams;
    if (bmad.version) workstreams.unshift({ id: 'bmad', label: `BMad ${bmad.version}`, docs: bmad.docs.filter((d) => d.workstream === 'bmad').length, updated: null });
    for (const it of bmad.items) it.workstream ||= bmad.version ? 'bmad' : null;
    const abbreviation = settings.abbreviation || defaultAbbreviation(path.basename(root));
    assignShortIds(root, bmad.items, abbreviation);

    const timeEntries = readTimeEntries(root);
    const sessions = summarizeSessions(sessionsForProject(this.allSessions, root), {
      idleMinutes: Number(settings.billing.idle_threshold_minutes) || 10,
      pricing: this.config.pricing,
      itemIds: bmad.items.map((i) => i.id),
      aliases: new Map([
        ...bmad.items.filter((i) => i.sprintKey).map((i) => [i.sprintKey.toLowerCase(), i.id]),
        ...bmad.items.map((i) => [i.shortId.toLowerCase(), i.id]),
      ]),
      root,
      workstreams: workstreams.map((w) => w.id).filter((w) => w !== 'bmad'),
      itemWorkstream: Object.fromEntries(bmad.items.map((i) => [i.id.toLowerCase(), i.workstream])),
    });

    // per-item actual effort
    const effortByItem = {};
    for (const s of sessions) if (s.itemId) {
      const e = (effortByItem[s.itemId] ||= { minutes: 0, cost: 0, sessions: 0 });
      e.minutes += s.activeMinutes; e.cost += s.cost; e.sessions++;
    }
    for (const t of timeEntries) if (t.itemId) {
      const e = (effortByItem[t.itemId] ||= { minutes: 0, cost: 0, sessions: 0 });
      e.minutes += t.minutes;
    }
    applyActivity(bmad.items, sessions, Date.now() - (this.config.activeItemDays ?? 7) * 86400000);
    trackHistory(this.config.dataDir, id, bmad.items);

    for (const it of bmad.items) {
      const e = effortByItem[it.id];
      it.actualMinutes = e ? Math.round(e.minutes) : 0;
      it.aiCost = e ? Math.round(e.cost * 100) / 100 : 0;
      it.sessions = e?.sessions || 0;
    }
    // per-workstream effort and status
    for (const w of workstreams) {
      const its = bmad.items.filter((i) => i.workstream === w.id);
      w.items = its.length;
      w.done = its.filter((i) => i.status === 'done').length;
      w.open = its.length - w.done;
      const ss = sessions.filter((s) => s.workstream === w.id || (w.id === 'bmad' && !s.workstream && s.itemId));
      w.minutes = Math.round(ss.reduce((a, s) => a + s.activeMinutes, 0) + timeEntries.filter((t) => t.workstream === w.id).reduce((a, t) => a + t.minutes, 0));
      w.aiCost = Math.round(ss.reduce((a, s) => a + s.cost, 0) * 100) / 100;
      w.sessions = ss.length;
      w.label ||= workstreamLabel(w.id);
    }
    const name = settings.name && settings.name !== path.basename(root) ? settings.name : id.split('~').join(' / ');
    return { id, root, name, abbreviation, justChangedHours: this.config.justChangedHours, workstreams, configured: hasSettings(root), bmadVersion: bmad.version || detectBmad(root), settings, ...bmad, sessions, timeEntries };
  }

  refreshProject(root) {
    const p = this.buildProject(root);
    this.projects.set(p.id, p);
    this.emit('changed', { at: new Date().toISOString(), project: p.id });
    return p;
  }

  get(id) { return this.projects.get(id); }

  summary(p) {
    const counts = Object.fromEntries(COLUMNS.map((c) => [c, 0]));
    const work = p.items.filter((i) => i.kind !== 'test');
    for (const it of work) counts[it.status]++;
    const now = new Date();
    const monthStart = localDate(new Date(now.getFullYear(), now.getMonth(), 1).toISOString());
    const monthMin = p.sessions.filter((s) => localDate(s.start) >= monthStart).reduce((a, s) => a + s.activeMinutes, 0)
      + p.timeEntries.filter((t) => t.date >= monthStart).reduce((a, t) => a + t.minutes, 0);
    const totalMin = p.sessions.reduce((a, s) => a + s.activeMinutes, 0) + p.timeEntries.reduce((a, t) => a + t.minutes, 0);
    const lastActivity = [p.sessions[0]?.end, ...p.items.map((i) => i.updated)].filter(Boolean).sort().pop() || null;
    return {
      id: p.id, name: p.name, customer: p.settings.customer, configured: p.configured, bmadVersion: p.bmadVersion,
      billingMode: p.settings.billing.mode, currency: p.settings.currency,
      counts, total: work.length, done: counts.done,
      percentDone: work.length ? Math.round((counts.done / work.length) * 100) : null,
      bugsOpen: p.items.filter((i) => i.kind === 'bug' && i.status !== 'done').length,
      actionItemsOpen: p.actionItems.filter((a) => a.status !== 'done').length,
      epics: p.epics.length,
      workstreams: p.workstreams.map((w) => ({ id: w.id, label: w.label, open: w.open || 0 })),
      docs: p.docs.length,
      hoursThisMonth: Math.round((monthMin / 60) * 10) / 10,
      hoursTotal: Math.round((totalMin / 60) * 10) / 10,
      aiCostTotal: Math.round(p.sessions.reduce((a, s) => a + s.cost, 0) * 100) / 100,
      sessions: p.sessions.length,
      lastActivity,
    };
  }

  watch() {
    // Watch md/html/yaml/json across each repo, skipping dependency and build folders.
    const roots = this.discover();
    const skip = new Set([...DEFAULT_EXCLUDE_DIRS, ...(this.config.docsExclude || [])].filter((d) => !['_bmad', '_bmad-output', '.bmad-core'].includes(d)));
    const projectWatcher = chokidar.watch(roots, {
      ignoreInitial: true,
      depth: 6,
      ignored: (p, stats) => p.split(path.sep).some((seg) => skip.has(seg)) || (stats?.isFile() && !/\.(md|html?|ya?ml|json)$/i.test(p)),
    });
    const claudeWatcher = chokidar.watch(path.join(this.config.claudeDir, 'projects'), {
      ignoreInitial: true, depth: 2, ignored: (p, stats) => stats?.isFile() && !p.endsWith('.jsonl'),
    });
    const schedule = (ms) => { clearTimeout(this.timer); this.timer = setTimeout(() => this.rebuild().catch(console.error), ms); };
    projectWatcher.on('all', () => schedule(500));
    claudeWatcher.on('all', () => schedule(3000)); // transcripts change every few seconds while you work
    return [projectWatcher, claudeWatcher];
  }
}
