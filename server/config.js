import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function expandHome(p) {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

// pmdai.config.json is the shared default; pmdai.local.json (gitignored) overrides it.
export function loadConfig() {
  const base = readJson(path.join(APP_ROOT, 'pmdai.config.json'));
  const local = readJson(path.join(APP_ROOT, 'pmdai.local.json'));
  const cfg = {
    ...base,
    ...local,
    defaults: { ...(base.defaults || {}), ...(local.defaults || {}) },
    pricing: { ...(base.pricing || {}), ...(local.pricing || {}) },
  };
  cfg.projectsRoot = expandHome(process.env.PMDAI_PROJECTS_ROOT || cfg.projectsRoot || '~/_projects');
  cfg.claudeDir = expandHome(process.env.PMDAI_CLAUDE_DIR || cfg.claudeDir || '~/.claude');
  cfg.port = Number(process.env.PORT || cfg.port || 4319);
  cfg.exclude = cfg.exclude || [];
  cfg.activeItemDays = Number(cfg.activeItemDays ?? 7); // how long a Claude session keeps an item "in progress"
  cfg.extraProjects = (cfg.extraProjects || []).map(expandHome);
  return cfg;
}
