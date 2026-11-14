import React, { useState } from 'react';
import { api, fmtHours } from '../api.js';
import { Field, KIND_LABEL } from './ui.jsx';

const KINDS = ['task', 'story', 'bug', 'change_request', 'support', 'meeting', 'test', 'seo', 'security'];

export default function TimeEntries({ p, onChange }) {
  const today = new Date().toLocaleDateString('en-CA');
  const [f, setF] = useState({ date: today, hours: '1', kind: 'meeting', itemId: '', workstream: '', note: '', billable: true });
  const [err, setErr] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const byId = new Map(p.items.map((i) => [i.id, i]));

  const add = async (e) => {
    e.preventDefault();
    setErr(null);
    try {
      await api.post(`/api/projects/${encodeURIComponent(p.id)}/time-entries`, { ...f, minutes: Math.round(Number(f.hours) * 60), itemId: f.itemId || null, workstream: f.workstream || null });
      setF({ ...f, note: '' });
      onChange();
    } catch (x) { setErr(x.message); }
  };
  const del = async (id) => { await api.del(`/api/projects/${encodeURIComponent(p.id)}/time-entries/${id}`); onChange(); };
  const entries = [...p.timeEntries].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div className="stack">
      <form className="card form-grid" onSubmit={add}>
        <h3 className="span-all">Log time spent outside Claude Code</h3>
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} required /></Field>
        <Field label="Hours"><input type="number" min="0.05" step="0.25" value={f.hours} onChange={set('hours')} required /></Field>
        <Field label="Type"><select value={f.kind} onChange={set('kind')}>{KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
        {p.workstreams.length > 0 && <Field label="Workstream (optional)"><select value={f.workstream} onChange={set('workstream')}><option value="">— none —</option>{p.workstreams.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}</select></Field>}
        <Field label="Item (optional)">
          <select value={f.itemId} onChange={set('itemId')}>
            <option value="">— none —</option>
            {p.items.map((i) => <option key={i.id} value={i.id}>{i.storyNum ? `${i.storyNum} ` : ''}{i.title.slice(0, 70)}</option>)}
          </select>
        </Field>
        <Field label="Note"><input value={f.note} onChange={set('note')} placeholder="e.g. Sprint review with customer" /></Field>
        <Field label="Billable"><input type="checkbox" checked={f.billable} onChange={set('billable')} /></Field>
        <div className="span-all row"><button className="btn">Add entry</button>{err && <span className="err">{err}</span>}</div>
      </form>
      <div className="card flush">
        <table className="table">
          <thead><tr><th>Date</th><th>Hours</th><th>Type</th><th>Item</th><th>Note</th><th>Billable</th><th /></tr></thead>
          <tbody>
            {entries.map((t) => (
              <tr key={t.id}>
                <td>{t.date}</td><td>{fmtHours(t.minutes)}</td><td>{KIND_LABEL[t.kind] || t.kind}</td>
                <td>{t.itemId ? byId.get(t.itemId)?.title || t.itemId : '—'}</td><td>{t.note}</td><td>{t.billable ? 'yes' : 'no'}</td>
                <td><button className="btn ghost small" onClick={() => del(t.id)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {!entries.length && <div className="empty">No manual entries yet. They're saved in <code>.pmdai/time-entries.json</code> in the project.</div>}
      </div>
    </div>
  );
}
