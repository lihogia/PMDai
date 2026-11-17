// Per-project settings (<repo>/.pmdai/project.yml) and manual time entries
// (<repo>/.pmdai/time-entries.json). Both live in the project repo; they hold billing data, so when the repo
// has a .gitignore, PMDai adds them to it before writing the first time.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import yaml from 'js-yaml';

export const BILLING_MODES = ['time_and_materials', 'per_story', 'milestone', 'retainer', 'hybrid'];
export const ITEM_KINDS = ['story', 'task', 'backlog', 'bug', 'change_request', 'test', 'meeting', 'support', 'seo', 'security', 'workstream'];

export function defaultSettings(name, defaults = {}) {
  return {
    name,
    abbreviation: '', // item ID prefix (PMD-BUG-4); empty = derived from the folder name
    customer: '',
    project_type: 'feature_work',
    currency: defaults.currency || 'USD',
    billing: {
      mode: 'time_and_materials',
      effective_from: null,
      hourly_rate: defaults.hourly_rate ?? 40,
      rounding_minutes: defaults.rounding_minutes ?? 15,
      idle_threshold_minutes: defaults.idle_threshold_minutes ?? 10,
      cap_hours: null,
      include_unattributed: true,
      per_story: { unit: 'points', rate_per_unit: 100, default_estimate: null, bill_on_status: 'done' },
      milestones: [],
      retainer: { monthly_fee: 0, included_hours: 0, overage_rate: defaults.hourly_rate ?? 40, rollover: false },
      hybrid: { fixed: ['story'], hourly: ['bug', 'change_request', 'support', 'workstream'] },
      bug_warranty_days: 30,
      delivered_on: null,
      ai_cost: 'absorb',
      ai_markup_pct: 0,
    },
  };
}

export function deepMerge(a, b) {
  if (Array.isArray(b)) return b;
  if (b && typeof b === 'object') {
    const out = { ...(a || {}) };
    for (const [k, v] of Object.entries(b)) out[k] = deepMerge(a?.[k], v);
    return out;
  }
  return b === undefined ? a : b;
}

const settingsFile = (root) => path.join(root, '.pmdai', 'project.yml');
const timeFile = (root) => path.join(root, '.pmdai', 'time-entries.json');

export const GITIGNORE_ENTRIES = ['.pmdai/project.yml', '.pmdai/time-entries.json'];

/** Append PMDai's files to the repo's .gitignore, if it has one. Lines that already cover them
 *  (the exact path, or the whole .pmdai folder, with or without a leading /) are respected.
 *  Returns the entries added. */
export function ensureGitignored(root) {
  const file = path.join(root, '.gitignore');
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const lines = new Set(text.split(/\r?\n/).map((l) => l.trim().replace(/^\//, '').replace(/\/$/, '')));
  if (lines.has('.pmdai') || lines.has('.pmdai/*') || lines.has('.pmdai/**')) return [];
  const missing = GITIGNORE_ENTRIES.filter((e) => !lines.has(e));
  if (!missing.length) return [];
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  fs.appendFileSync(file, `${sep}\n# PMDai (billing settings and time entries)\n${missing.join('\n')}\n`);
  return missing;
}

export function hasSettings(root) {
  return fs.existsSync(settingsFile(root));
}

export function readSettings(root, defaults) {
  const base = defaultSettings(path.basename(root), defaults);
  try {
    const loaded = yaml.load(fs.readFileSync(settingsFile(root), 'utf8')) || {};
    return deepMerge(base, loaded);
  } catch {
    return base;
  }
}

export function validateSettings(s) {
  const errors = [];
  const b = s.billing || {};
  if (!BILLING_MODES.includes(b.mode)) errors.push(`billing.mode must be one of ${BILLING_MODES.join(', ')}`);
  for (const k of ['hourly_rate', 'rounding_minutes', 'idle_threshold_minutes', 'bug_warranty_days', 'ai_markup_pct']) {
    if (b[k] != null && (isNaN(Number(b[k])) || Number(b[k]) < 0)) errors.push(`billing.${k} must be a non-negative number`);
  }
  if (!['absorb', 'pass_through', 'markup'].includes(b.ai_cost)) errors.push('billing.ai_cost must be absorb, pass_through or markup');
  for (const [i, m] of (b.milestones || []).entries()) {
    if (!m.name) errors.push(`milestone ${i + 1} needs a name`);
    if (isNaN(Number(m.amount))) errors.push(`milestone ${i + 1} amount must be a number`);
  }
  return errors;
}

export function writeSettings(root, settings) {
  const errors = validateSettings(settings);
  if (errors.length) { const e = new Error(errors.join('; ')); e.status = 400; throw e; }
  ensureGitignored(root);
  fs.mkdirSync(path.dirname(settingsFile(root)), { recursive: true });
  const header = '# PMDai project settings - edited from the PMDai dashboard or by hand.\n';
  fs.writeFileSync(settingsFile(root), header + yaml.dump(settings, { lineWidth: 120, noRefs: true }));
  return settings;
}

export function readTimeEntries(root) {
  try { return JSON.parse(fs.readFileSync(timeFile(root), 'utf8')); } catch { return []; }
}

function saveTimeEntries(root, entries) {
  ensureGitignored(root);
  fs.mkdirSync(path.dirname(timeFile(root)), { recursive: true });
  fs.writeFileSync(timeFile(root), JSON.stringify(entries, null, 2) + '\n');
}

export function addTimeEntry(root, entry) {
  const minutes = Number(entry.minutes);
  if (!entry.date || isNaN(Date.parse(entry.date))) { const e = new Error('date is required (YYYY-MM-DD)'); e.status = 400; throw e; }
  if (!(minutes > 0)) { const e = new Error('minutes must be > 0'); e.status = 400; throw e; }
  const entries = readTimeEntries(root);
  const row = {
    id: crypto.randomUUID(),
    date: entry.date,
    minutes,
    kind: ITEM_KINDS.includes(entry.kind) ? entry.kind : 'task',
    itemId: entry.itemId || null,
    workstream: entry.workstream || null,
    note: String(entry.note || '').slice(0, 500),
    billable: entry.billable !== false,
  };
  entries.push(row);
  saveTimeEntries(root, entries);
  return row;
}

export function deleteTimeEntry(root, id) {
  const entries = readTimeEntries(root);
  const next = entries.filter((e) => e.id !== id);
  saveTimeEntries(root, next);
  return entries.length !== next.length;
}
