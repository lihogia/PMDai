// Item history: when PMDai first saw each item and when its status last changed, so Board and Items can put
// just-added and just-moved items first. PMDai keeps no other history, so it compares each index run with the
// last status it saw. Kept in <dataDir>/history/<project>.json, outside project repos (it changes constantly).
import fs from 'node:fs';
import path from 'node:path';

const latest = (...ts) => ts.filter(Boolean).sort().pop() || null;

/** Update `saved` ({ itemId: { status, firstSeen, changedAt, from } }) with the current items, and set
 *  `firstSeen`, `statusChangedAt` and `prevStatus` on each item. Returns true when `saved` changed. Exported for tests. */
export function trackItems(saved, items, now = new Date().toISOString()) {
  let changed = false;
  const firstRun = Object.keys(saved).length === 0;
  for (const it of items) {
    const prev = saved[it.id];
    if (!prev) {
      // Added: its own created date. On a project's first run, items without one were there before tracking
      // began (a tracker file's time is shared by all its lines), so they aren't flagged as new.
      saved[it.id] = { status: it.status, firstSeen: it.created || (firstRun ? null : it.updated || now), changedAt: null, from: null };
      // A tracker file in git tells what the first run can't: lines added or moved in the window before it
      if (firstRun && it.statusBefore === 'absent') saved[it.id].firstSeen = it.created || it.updated || now;
      else if (firstRun && it.statusBefore && it.statusBefore !== it.status) Object.assign(saved[it.id], { from: it.statusBefore, changedAt: it.updated || now });
      changed = true;
    } else if (prev.status !== it.status) {
      // Moved: when the file or the Claude session changed it, if that's after the status we had; else now,
      // the first moment PMDai noticed
      const at = latest(it.updated, it.lastWorkedAt);
      Object.assign(prev, { from: prev.status, status: it.status, changedAt: at && at > (prev.changedAt || prev.firstSeen || '') && at <= now ? at : now });
      changed = true;
    }
    const h = saved[it.id];
    it.firstSeen = h.firstSeen;
    it.statusChangedAt = h.changedAt;
    it.prevStatus = h.from;
  }
  return changed;
}

export function trackHistory(dataDir, projectId, items) {
  const file = path.join(dataDir, 'history', `${projectId}.json`);
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch {}
  if (!trackItems(saved, items)) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(saved) + '\n');
  } catch (e) { console.warn(`[pmdai] could not save item history ${file}: ${e.message}`); }
}
