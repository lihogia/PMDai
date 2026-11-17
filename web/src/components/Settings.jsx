import React, { useEffect, useState } from 'react';
import { api } from '../api.js';
import { Field } from './ui.jsx';

const MODES = [
  ['time_and_materials', 'Time & materials', 'Tracked hours × hourly rate. Best for maintenance, discovery or unclear scope.'],
  ['per_story', 'Fixed per story', 'Each done story bills its estimate × rate. Best for feature work on an existing app.'],
  ['milestone', 'Fixed price by milestone', 'Agreed amounts tied to BMad epics; bill when the epic is done. Best for new builds with an agreed PRD.'],
  ['retainer', 'Retainer', 'Monthly fee with included hours, overage billed hourly. Best for ongoing support.'],
  ['hybrid', 'Hybrid', 'Fixed price for agreed scope, hourly for bugs and change requests.'],
];
const PROJECT_TYPES = {
  new_build: ['New build with an agreed PRD', 'milestone'],
  feature_work: ['Feature work on an existing app', 'per_story'],
  maintenance: ['Maintenance & support', 'retainer'],
  discovery: ['Discovery / prototype', 'time_and_materials'],
  bug_fixing: ['Bug fixing', 'time_and_materials'],
};
const KINDS = ['story', 'task', 'backlog', 'bug', 'change_request', 'support', 'meeting', 'test', 'seo', 'security', 'workstream'];

export default function Settings({ p, onSaved }) {
  const [s, setS] = useState(p.settings);
  const [msg, setMsg] = useState(null);
  useEffect(() => setS(p.settings), [p.settings]);
  const b = s.billing;
  const setTop = (k, v) => setS({ ...s, [k]: v });
  const setB = (k, v) => setS({ ...s, billing: { ...b, [k]: v } });
  const setSub = (sub, k, v) => setB(sub, { ...b[sub], [k]: v });
  const num = (v) => (v === '' ? null : Number(v));
  const toggleKind = (list, k) => {
    const cur = b.hybrid[list] || [];
    setSub('hybrid', list, cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]);
  };

  const save = async () => {
    setMsg(null);
    try {
      await api.put(`/api/projects/${encodeURIComponent(p.id)}/settings`, s);
      setMsg({ ok: true, text: 'Saved to .pmdai/project.yml' });
      onSaved();
    } catch (e) { setMsg({ ok: false, text: e.message }); }
  };

  const suggested = PROJECT_TYPES[s.project_type]?.[1];
  return (
    <div className="stack settings">
      <div className="card form-grid">
        <h3 className="span-all">Project</h3>
        <Field label="Display name"><input value={s.name || ''} onChange={(e) => setTop('name', e.target.value)} /></Field>
        <Field label="Item ID prefix" hint={`IDs look like ${s.abbreviation || p.abbreviation}-BUG-4. Changing it renames every ID.`}>
          <input value={s.abbreviation || ''} onChange={(e) => setTop('abbreviation', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))} placeholder={p.abbreviation} />
        </Field>
        <Field label="Customer"><input value={s.customer || ''} onChange={(e) => setTop('customer', e.target.value)} placeholder="Who gets the invoice" /></Field>
        <Field label="Currency"><input value={s.currency || ''} onChange={(e) => setTop('currency', e.target.value.toUpperCase())} maxLength={3} /></Field>
        <Field label="Project type" hint={suggested ? `Suggested billing: ${MODES.find((m) => m[0] === suggested)[1]}` : ''}>
          <select value={s.project_type} onChange={(e) => setTop('project_type', e.target.value)}>
            {Object.entries(PROJECT_TYPES).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      </div>

      <div className="card">
        <h3>Billing mode</h3>
        <div className="modes">
          {MODES.map(([k, label, desc]) => (
            <label key={k} className={`mode ${b.mode === k ? 'active' : ''}`}>
              <input type="radio" name="mode" checked={b.mode === k} onChange={() => setB('mode', k)} />
              <b>{label}{suggested === k && <span className="tag tag-blue">suggested</span>}</b>
              <span className="muted small">{desc}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card form-grid">
        <h3 className="span-all">Time tracking</h3>
        <Field label="Hourly rate"><input type="number" min="0" value={b.hourly_rate ?? ''} onChange={(e) => setB('hourly_rate', num(e.target.value))} /></Field>
        <Field label="Round each session up to (min)"><input type="number" min="0" value={b.rounding_minutes ?? ''} onChange={(e) => setB('rounding_minutes', num(e.target.value))} /></Field>
        <Field label="Idle threshold (min)" hint="Gaps longer than this don't count as active time"><input type="number" min="1" value={b.idle_threshold_minutes ?? ''} onChange={(e) => setB('idle_threshold_minutes', num(e.target.value))} /></Field>
        <Field label="Effective from"><input type="date" value={b.effective_from || ''} onChange={(e) => setB('effective_from', e.target.value || null)} /></Field>
        {b.mode === 'time_and_materials' && <>
          <Field label="Hour cap (not-to-exceed)" hint="Empty = no cap"><input type="number" min="0" value={b.cap_hours ?? ''} onChange={(e) => setB('cap_hours', num(e.target.value))} /></Field>
          <Field label="Bill unlinked Claude time"><input type="checkbox" checked={!!b.include_unattributed} onChange={(e) => setB('include_unattributed', e.target.checked)} /></Field>
        </>}
      </div>

      {(b.mode === 'per_story' || b.mode === 'hybrid') && (
        <div className="card form-grid">
          <h3 className="span-all">Per-story pricing</h3>
          <Field label="Unit"><select value={b.per_story.unit} onChange={(e) => setSub('per_story', 'unit', e.target.value)}><option value="points">Story points</option><option value="hours">Estimated hours</option></select></Field>
          <Field label="Rate per unit"><input type="number" min="0" value={b.per_story.rate_per_unit ?? ''} onChange={(e) => setSub('per_story', 'rate_per_unit', num(e.target.value))} /></Field>
          <Field label="Default estimate" hint="Used when a story has no estimate: in frontmatter"><input type="number" min="0" value={b.per_story.default_estimate ?? ''} onChange={(e) => setSub('per_story', 'default_estimate', num(e.target.value))} /></Field>
        </div>
      )}

      {b.mode === 'hybrid' && (
        <div className="card">
          <h3>Hybrid split</h3>
          <div className="two">
            <div><b>Fixed price</b><div className="checks">{KINDS.map((k) => <label key={k}><input type="checkbox" checked={(b.hybrid.fixed || []).includes(k)} onChange={() => toggleKind('fixed', k)} /> {k}</label>)}</div></div>
            <div><b>Hourly</b><div className="checks">{KINDS.map((k) => <label key={k}><input type="checkbox" checked={(b.hybrid.hourly || []).includes(k)} onChange={() => toggleKind('hourly', k)} /> {k}</label>)}</div></div>
          </div>
        </div>
      )}

      {b.mode === 'milestone' && (
        <div className="card">
          <h3>Milestones</h3>
          <table className="table">
            <thead><tr><th>Name</th><th>Epic</th><th>Amount</th><th>Invoiced</th><th /></tr></thead>
            <tbody>
              {(b.milestones || []).map((m, i) => {
                const upd = (k, v) => setB('milestones', b.milestones.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
                return (
                  <tr key={i}>
                    <td><input value={m.name || ''} onChange={(e) => upd('name', e.target.value)} /></td>
                    <td><select value={m.epic ?? ''} onChange={(e) => upd('epic', num(e.target.value))}><option value="">—</option>{p.epics.map((e) => <option key={e.number} value={e.number}>{e.number}. {e.title}</option>)}</select></td>
                    <td><input type="number" value={m.amount ?? ''} onChange={(e) => upd('amount', num(e.target.value))} /></td>
                    <td><input type="checkbox" checked={!!m.invoiced} onChange={(e) => upd('invoiced', e.target.checked)} /></td>
                    <td><button className="btn ghost small" onClick={() => setB('milestones', b.milestones.filter((_, j) => j !== i))}>Remove</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <button className="btn ghost" onClick={() => setB('milestones', [...(b.milestones || []), { name: '', epic: p.epics[0]?.number ?? null, amount: 0, invoiced: false }])}>+ Add milestone</button>
          {p.epics.length > 0 && !(b.milestones || []).length && (
            <button className="btn ghost" onClick={() => setB('milestones', p.epics.map((e) => ({ name: e.title, epic: e.number, amount: 0, invoiced: false })))}>Create one per epic</button>
          )}
        </div>
      )}

      {b.mode === 'retainer' && (
        <div className="card form-grid">
          <h3 className="span-all">Retainer</h3>
          <Field label="Monthly fee"><input type="number" min="0" value={b.retainer.monthly_fee ?? ''} onChange={(e) => setSub('retainer', 'monthly_fee', num(e.target.value))} /></Field>
          <Field label="Included hours / month"><input type="number" min="0" value={b.retainer.included_hours ?? ''} onChange={(e) => setSub('retainer', 'included_hours', num(e.target.value))} /></Field>
          <Field label="Overage rate"><input type="number" min="0" value={b.retainer.overage_rate ?? ''} onChange={(e) => setSub('retainer', 'overage_rate', num(e.target.value))} /></Field>
          <Field label="Roll over unused hours"><input type="checkbox" checked={!!b.retainer.rollover} onChange={(e) => setSub('retainer', 'rollover', e.target.checked)} /></Field>
        </div>
      )}

      <div className="card form-grid">
        <h3 className="span-all">Bugs &amp; AI cost</h3>
        <Field label="Delivered on" hint="Start of the bug warranty window"><input type="date" value={b.delivered_on || ''} onChange={(e) => setB('delivered_on', e.target.value || null)} /></Field>
        <Field label="Bug warranty (days)" hint="Bugs created within this window are free"><input type="number" min="0" value={b.bug_warranty_days ?? ''} onChange={(e) => setB('bug_warranty_days', num(e.target.value))} /></Field>
        <Field label="AI token cost">
          <select value={b.ai_cost} onChange={(e) => setB('ai_cost', e.target.value)}>
            <option value="absorb">Absorb (not on invoice)</option>
            <option value="pass_through">Pass through at cost</option>
            <option value="markup">Pass through with markup</option>
          </select>
        </Field>
        {b.ai_cost === 'markup' && <Field label="Markup %"><input type="number" min="0" value={b.ai_markup_pct ?? ''} onChange={(e) => setB('ai_markup_pct', num(e.target.value))} /></Field>}
      </div>

      <div className="row sticky-save">
        <button className="btn" onClick={save}>Save settings</button>
        <button className="btn ghost" onClick={() => setS(p.settings)}>Reset</button>
        {msg && <span className={msg.ok ? 'ok' : 'err'}>{msg.text}</span>}
      </div>
    </div>
  );
}
