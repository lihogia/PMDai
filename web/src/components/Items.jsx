import React, { useMemo, useState } from 'react';
import { StatusPill, KindTag, ActivityTag } from './ui.jsx';
import ItemDialog from './ItemDialog.jsx';
import { fmtHours, fmtDate, fmtMoney } from '../api.js';

export default function Items({ p }) {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [status, setStatus] = useState('all');
  const [ws, setWs] = useState('all');
  const [open, setOpen] = useState(null);
  const wsLabel = new Map((p.workstreams || []).map((w) => [w.id, w.label]));
  const [sort, setSort] = useState({ key: 'updated', dir: -1 });
  const kinds = [...new Set(p.items.map((i) => i.kind))];
  const rows = useMemo(() => {
    const ql = q.toLowerCase();
    return p.items
      .filter((i) => (ws === 'all' || i.workstream === ws) && (kind === 'all' || i.kind === kind) && (status === 'all' || i.status === status) && (!ql || i.title.toLowerCase().includes(ql) || i.id.includes(ql) || i.shortId.toLowerCase().includes(ql)))
      .sort((a, b) => {
        const va = a[sort.key] ?? ''; const vb = b[sort.key] ?? '';
        return (typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb))) * sort.dir;
      });
  }, [p.items, q, kind, status, sort, ws]);
  const th = (key, label) => <th onClick={() => setSort((s) => ({ key, dir: s.key === key ? -s.dir : -1 }))} className="sortable">{label}{sort.key === key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}</th>;

  return (
    <div className="stack">
      <div className="row filters">
        <input placeholder="Search items…" value={q} onChange={(e) => setQ(e.target.value)} />
        {(p.workstreams || []).length > 1 && <select value={ws} onChange={(e) => setWs(e.target.value)}><option value="all">All workstreams</option>{p.workstreams.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select>}
        <select value={kind} onChange={(e) => setKind(e.target.value)}><option value="all">All types</option>{kinds.map((k) => <option key={k}>{k}</option>)}</select>
        <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">All statuses</option>{['backlog', 'ready', 'in-progress', 'review', 'done'].map((k) => <option key={k}>{k}</option>)}</select>
        <span className="muted small">{rows.length} of {p.items.length}</span>
      </div>
      <div className="card flush">
        <table className="table">
          <thead><tr>{th('shortId', 'ID')}{th('title', 'Item')}{th('workstream', 'Workstream')}{th('kind', 'Type')}{th('status', 'Status')}{th('priority', 'Priority')}{th('epic', 'Epic')}{th('estimate', 'Est.')}{th('actualMinutes', 'Effort')}{th('aiCost', 'AI cost')}{th('created', 'Created')}{th('updated', 'Updated')}</tr></thead>
          <tbody>
            {rows.map((i) => (
              <tr key={i.id} className="clickable" onClick={() => setOpen(i)}>
                <td className="sid">{i.shortId}</td>
                <td title={[i.file || i.sprintKey, i.note].filter(Boolean).join(' · ')}>{i.storyNum && <b>{i.storyNum} </b>}{i.title}</td>
                <td className="muted small">{wsLabel.get(i.workstream) || '—'}</td>
                <td><KindTag kind={i.kind} /></td>
                <td><StatusPill status={i.status} raw={i.rawStatus} /> <ActivityTag item={i} /></td>
                <td>{i.priority || '—'}</td>
                <td>{i.epic ?? '—'}</td>
                <td>{i.estimate ?? '—'}</td>
                <td>{i.actualMinutes ? fmtHours(i.actualMinutes) : '—'}</td>
                <td>{i.aiCost ? fmtMoney(i.aiCost) : '—'}</td>
                <td>{fmtDate(i.created)}</td>
                <td>{fmtDate(i.updated)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {open && <ItemDialog projectId={p.id} item={open} onClose={() => setOpen(null)} />}
      <p className="muted small">Effort is linked to an item when a Claude session mentions its spec file or story key. Mention an item's ID (e.g. <code>{p.abbreviation}-BUG-4</code>) in a prompt to link the session to it. Add <code>estimate:</code> to an item's frontmatter for per-story billing. Items outside BMad come from tracker files (status.md, BACKLOG.md, todo.md…): checkboxes, table rows under a Done / To do / Still open heading, and sub-headings under those.</p>
    </div>
  );
}
