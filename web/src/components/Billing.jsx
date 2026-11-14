import React, { useState } from 'react';
import { useData, fmtMoney } from '../api.js';
import { Empty, Field } from './ui.jsx';

const MODE_LABEL = { time_and_materials: 'Time & materials', per_story: 'Fixed per story', milestone: 'Fixed price by milestone', retainer: 'Retainer', hybrid: 'Hybrid' };

function monthRange(offset = 0) {
  const n = new Date();
  const f = (d) => d.toLocaleDateString('en-CA');
  return { from: f(new Date(n.getFullYear(), n.getMonth() + offset, 1)), to: f(new Date(n.getFullYear(), n.getMonth() + offset + 1, 0)) };
}

export default function Billing({ p }) {
  const [period, setPeriod] = useState(monthRange(0));
  const base = `/api/projects/${encodeURIComponent(p.id)}/invoice?from=${period.from}&to=${period.to}`;
  const { data: inv, error } = useData(base);
  const cur = p.settings.currency;

  return (
    <div className="stack">
      <div className="row filters">
        <Field label="From"><input type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} /></Field>
        <Field label="To"><input type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} /></Field>
        <button className="btn ghost" onClick={() => setPeriod(monthRange(-1))}>Last month</button>
        <button className="btn ghost" onClick={() => setPeriod(monthRange(0))}>This month</button>
        <div className="spacer" />
        <a className="btn" href={`${base}&format=csv`}>Export CSV</a>
        <button className="btn ghost" onClick={() => window.print()}>Print / PDF</button>
      </div>
      {error && <Empty>{error.message}</Empty>}
      {inv && (
        <>
          <div className="card invoice">
            <div className="row">
              <div>
                <h2>Invoice draft</h2>
                <div className="muted">{p.settings.customer || <i>No customer set</i>} · {p.name}</div>
                <div className="muted small">{inv.period.from} → {inv.period.to} · {MODE_LABEL[inv.mode]}</div>
              </div>
              <div className="spacer" />
              <div className="total"><span className="muted small">Subtotal</span><b>{fmtMoney(inv.subtotal, cur)}</b></div>
            </div>
            <table className="table">
              <thead><tr><th>Description</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate</th><th className="num">Amount</th></tr></thead>
              <tbody>
                {inv.lines.map((l, i) => (
                  <tr key={i} className={`c-${l.category}`}>
                    <td>{l.description}</td><td className="num">{l.qty}</td><td>{l.unit}</td>
                    <td className="num">{fmtMoney(l.rate, cur)}</td><td className="num">{fmtMoney(l.amount, cur)}</td>
                  </tr>
                ))}
                {!inv.lines.length && <tr><td colSpan="5" className="muted">Nothing billable in this period.</td></tr>}
              </tbody>
              <tfoot><tr><td colSpan="4"><b>Subtotal</b></td><td className="num"><b>{fmtMoney(inv.subtotal, cur)}</b></td></tr></tfoot>
            </table>
          </div>

          {inv.milestones && (
            <div className="card">
              <h3>Milestones</h3>
              <table className="table">
                <thead><tr><th>Milestone</th><th>Epic</th><th>Progress</th><th className="num">Amount</th><th>State</th></tr></thead>
                <tbody>{inv.milestones.map((m, i) => (
                  <tr key={i}><td>{m.name}</td><td>{m.epic} {m.epicTitle && `· ${m.epicTitle}`}</td><td>{m.progress}</td><td className="num">{fmtMoney(m.amount, cur)}</td>
                    <td>{m.invoiced ? 'invoiced' : m.billable ? <b>bill now</b> : m.done ? `done ${m.doneDate || ''}` : 'in progress'}</td></tr>
                ))}</tbody>
              </table>
            </div>
          )}

          <div className="card no-print">
            <h3>Internal view (not on the invoice)</h3>
            <div className="kpis">
              <div className="kpi"><div className="kpi-v">{inv.internal.actualHours} h</div><div className="kpi-l">actual effort ({inv.internal.claudeHours} Claude + {inv.internal.manualHours} manual)</div></div>
              <div className="kpi"><div className="kpi-v">{fmtMoney(inv.internal.aiCost)}</div><div className="kpi-l">AI cost ({p.settings.billing.ai_cost.replace('_', ' ')})</div></div>
              <div className="kpi"><div className="kpi-v">{inv.internal.effectiveHourlyRate != null ? fmtMoney(inv.internal.effectiveHourlyRate, cur) : '—'}</div><div className="kpi-l">effective rate / hour</div></div>
            </div>
            {inv.warnings.length > 0 && <ul className="warnings">{inv.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          </div>
        </>
      )}
    </div>
  );
}
