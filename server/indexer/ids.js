// Short item IDs like PMD-E2-3 (epic 2, story 3), PMD-BUG-4, PMD-BL-7.
// Stories with an epic derive theirs (a story split over several spec files gets PMD-E5-6, PMD-E5-6b, ...).
// Every other item gets the next number for its type the first time PMDai sees it, remembered in
// <repo>/.pmdai/ids.json (commit it, so IDs stay the same everywhere). The file stores only "BUG-4",
// so changing the project abbreviation renames every ID consistently.
import fs from 'node:fs';
import path from 'node:path';

const TYPE_CODE = { story: 'S', bug: 'BUG', backlog: 'BL', task: 'T', test: 'TEST', seo: 'SEO', security: 'SEC' };

// Matches a short ID as written in a prompt or reply (lowercased by the session scanner)
export const SHORT_ID_RE = /^[a-z][a-z0-9]{1,5}-(?:e\d+-\d+[a-z]?|[a-z]+-\d+)$/;

/** "PMDai" -> "PMD", "claude-howto" -> "CH", "coreplatform" -> "COR". */
export function defaultAbbreviation(name) {
  const words = String(name || '').split(/[^A-Za-z0-9]+|(?<=[a-z])(?=[A-Z][a-z])/).filter(Boolean);
  const abbr = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] || 'PRJ').slice(0, 3);
  return abbr.toUpperCase().slice(0, 6);
}

const idsFile = (root) => path.join(root, '.pmdai', 'ids.json');

/** Set `shortId` on every item, numbering new ones and saving them to .pmdai/ids.json. */
export function assignShortIds(root, items, abbreviation) {
  const abbr = abbreviation || defaultAbbreviation(path.basename(root));
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(idsFile(root), 'utf8')) || {}; } catch {}
  // Highest number ever handed out per type, including items that are gone, so numbers are never reused
  const max = {};
  for (const v of Object.values(saved)) {
    const m = /^([A-Z]+)-(\d+)$/.exec(v);
    if (m) max[m[1]] = Math.max(max[m[1]] || 0, Number(m[2]));
  }
  const fresh = [];
  const stories = new Map(); // "E5-6" -> items
  for (const it of items) {
    const story = /^(\d+)\.(\d+)$/.exec(it.storyNum || '');
    if (it.kind === 'story' && it.epic != null && story) {
      const key = `E${story[1]}-${story[2]}`;
      stories.set(key, [...(stories.get(key) || []), it]);
    } else if (saved[it.id]) it.shortId = `${abbr}-${saved[it.id]}`;
    else fresh.push(it);
  }
  for (const [key, its] of stories) {
    // the one sprint-status.yaml points at keeps the plain ID, then by id
    its.sort((a, b) => Number(!a.sprintKey) - Number(!b.sprintKey) || a.id.localeCompare(b.id));
    its.forEach((it, n) => { it.shortId = `${abbr}-${key}${n ? String.fromCharCode(97 + Math.min(n, 25)) : ''}`; });
  }
  // Oldest first, so the first run numbers items in the order they were written
  fresh.sort((a, b) => String(a.created || a.updated || '').localeCompare(String(b.created || b.updated || ''))
    || String(a.file || '').localeCompare(String(b.file || '')) || (a.line || 0) - (b.line || 0));
  for (const it of fresh) {
    const code = TYPE_CODE[it.kind] || it.kind.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || 'T';
    max[code] = (max[code] || 0) + 1;
    saved[it.id] = `${code}-${max[code]}`;
    it.shortId = `${abbr}-${saved[it.id]}`;
  }
  if (fresh.length) {
    try {
      fs.mkdirSync(path.dirname(idsFile(root)), { recursive: true });
      fs.writeFileSync(idsFile(root), JSON.stringify(saved, null, 2) + '\n');
    } catch (e) { console.warn(`[pmdai] could not save item IDs in ${root}: ${e.message}`); }
  }
}
