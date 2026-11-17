import React from 'react';
import { fmtAgo } from '../api.js';

export const COL_LABEL = { backlog: 'Backlog', ready: 'Ready', 'in-progress': 'In progress', review: 'Review', done: 'Done' };
export const KIND_LABEL = { story: 'Story', bug: 'Bug', backlog: 'Backlog', task: 'Task', test: 'Test', change_request: 'Change request', support: 'Support', meeting: 'Meeting', seo: 'SEO', security: 'Security', workstream: 'Workstream time' };

export function StatusBar({ counts }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0) || 1;
  return (
    <div className="statusbar" title={Object.entries(counts).map(([k, v]) => `${COL_LABEL[k]}: ${v}`).join(' · ')}>
      {Object.entries(counts).map(([k, v]) => v > 0 && <span key={k} className={`seg s-${k}`} style={{ width: `${(v / total) * 100}%` }} />)}
    </div>
  );
}

export const StatusPill = ({ status, raw }) => <span className={`pill s-${status}`} title={raw || ''}>{COL_LABEL[status] || status}</span>;
export const ActivityTag = ({ item }) => item.activity
  ? <span className={`tag act-${item.activity}`} title={`Claude session ${fmtAgo(item.lastWorkedAt)}`}>{item.activity}</span>
  : null;
// "Just" = within the window before the moment you're looking at the page
export function recentEvent(i, hours = 24, now = Date.now()) {
  const within = (t) => t && now - Date.parse(t) <= hours * 3600000;
  const moved = i.prevStatus && within(i.statusChangedAt) ? { kind: 'moved', at: i.statusChangedAt } : null;
  const added = within(i.firstSeen) ? { kind: 'new', at: i.firstSeen } : null;
  return [moved, added].filter(Boolean).sort((a, b) => b.at.localeCompare(a.at))[0] || null;
}

/** Just-moved and just-added items first (newest first), then the rest by when they were added or updated. */
export function sortRecentFirst(items, hours) {
  const now = Date.now();
  const touched = (i) => [i.created, i.updated].filter(Boolean).sort().pop() || '';
  return items.map((i) => [i, recentEvent(i, hours, now)])
    .sort(([a, ra], [b, rb]) => (rb ? 1 : 0) - (ra ? 1 : 0) || (ra && rb ? rb.at.localeCompare(ra.at) : touched(b).localeCompare(touched(a))))
    .map(([i]) => i);
}

export function RecentTag({ item, hours }) {
  const r = recentEvent(item, hours);
  if (!r) return null;
  const text = r.kind === 'new' ? 'new' : `${COL_LABEL[item.prevStatus] || item.prevStatus} → ${COL_LABEL[item.status] || item.status}`;
  return <span className={`tag recent-${r.kind}`} title={new Date(r.at).toLocaleString()}>{text} · {fmtAgo(r.at)}</span>;
}
export const KindTag = ({ kind }) => <span className={`tag k-${kind}`}>{KIND_LABEL[kind] || kind}</span>;
export const Empty = ({ children }) => <div className="empty">{children}</div>;

export function Field({ label, hint, children }) {
  return (
    <label className="field">
      <span className="field-l">{label}</span>
      {children}
      {hint && <span className="field-h">{hint}</span>}
    </label>
  );
}
