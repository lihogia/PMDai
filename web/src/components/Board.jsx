import React, { useState } from 'react';
import { COL_LABEL, KindTag } from './ui.jsx';
import ItemDialog from './ItemDialog.jsx';
import { fmtHours } from '../api.js';

const COLS = ['backlog', 'ready', 'in-progress', 'review', 'done'];

export default function Board({ projectId, items, epics, workstreams = [] }) {
  const [open, setOpen] = useState(null);
  const [epic, setEpic] = useState('all');
  const [ws, setWs] = useState('all');
  const [kind, setKind] = useState('all');
  const kinds = [...new Set(items.map((i) => i.kind))];
  const shown = items.filter((i) => (ws === 'all' || i.workstream === ws) && (epic === 'all' || String(i.epic) === epic) && (kind === 'all' || i.kind === kind));
  return (
    <div className="stack">
      <div className="row filters">
        {workstreams.length > 1 && <select value={ws} onChange={(e) => setWs(e.target.value)}><option value="all">All workstreams</option>{workstreams.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select>}
        {epics.length > 0 && <select value={epic} onChange={(e) => setEpic(e.target.value)}>
          <option value="all">All epics</option>
          {epics.map((e) => <option key={e.number} value={String(e.number)}>Epic {e.number}: {e.title}</option>)}
        </select>}
        <select value={kind} onChange={(e) => setKind(e.target.value)}>
          <option value="all">All types</option>
          {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
        <span className="muted small">{shown.length} items</span>
      </div>
      <div className="board">
        {COLS.map((c) => {
          const col = shown.filter((i) => i.status === c).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
          return (
            <div key={c} className="col">
              <div className={`col-head s-${c}`}>{COL_LABEL[c]} <span>{col.length}</span></div>
              {col.slice(0, 150).map((i) => (
                <div key={i.id} className="ticket" onClick={() => setOpen(i)}>
                  <div className="ticket-t">{i.storyNum && <b>{i.storyNum} </b>}{i.title}</div>
                  <div className="row small muted">
                    <KindTag kind={i.kind} />
                    {i.tasksTotal > 0 && <span>☑ {i.tasksDone}/{i.tasksTotal}</span>}
                    <div className="spacer" />
                    {i.actualMinutes > 0 && <span title="Tracked effort">{fmtHours(i.actualMinutes)}</span>}
                    {i.priority && <span className="tag">{i.priority}</span>}
                    {i.estimate != null && <span title="Estimate">est {i.estimate}</span>}
                  </div>
                </div>
              ))}
              {col.length > 150 && <div className="muted small">+{col.length - 150} more</div>}
            </div>
          );
        })}
      </div>
      {open && <ItemDialog projectId={projectId} item={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
