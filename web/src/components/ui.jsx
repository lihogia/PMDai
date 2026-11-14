import React from 'react';

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
