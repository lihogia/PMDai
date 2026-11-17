// Small read-only git helpers for tracker files: when each line last changed, and what a file looked like at a
// past moment. Both return null outside a git repo (or on any git error), so callers fall back to file times.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const git = (root, args) => {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024 });
  } catch { return null; }
};

/** ISO time each line (index 0 = line 1) of the working-tree file last changed; uncommitted lines get the file's time. */
export function lineTimes(root, rel) {
  const out = git(root, ['blame', '--line-porcelain', '--', rel]);
  if (out == null) return null;
  let mtime = null;
  try { mtime = fs.statSync(path.join(root, rel)).mtime.toISOString(); } catch {}
  const times = [];
  let hash = null;
  let time = null;
  for (const l of out.split('\n')) {
    const h = /^([0-9a-f]{40}) \d+ \d+/.exec(l);
    if (h) { hash = h[1]; time = null; continue; }
    if (l.startsWith('committer-time ')) time = new Date(Number(l.slice(15)) * 1000).toISOString();
    else if (l.startsWith('\t')) times.push(/^0+$/.test(hash) ? mtime : time);
  }
  return times;
}

/** The last commit before `beforeIso`: a hash, '' when the repo has none that old, null outside git. */
export function revBefore(root, beforeIso) {
  const rev = git(root, ['rev-list', '-1', `--before=${beforeIso}`, 'HEAD']);
  return rev == null ? null : rev.trim();
}

/** The file's content at `rev` ('' if it didn't exist there). */
export function fileAt(root, rev, rel) {
  if (!rev) return '';
  return git(root, ['show', `${rev}:./${rel.split(path.sep).join('/')}`]) ?? '';
}
