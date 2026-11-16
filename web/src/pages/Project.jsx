import React from 'react';
import { useData, fmtAgo, fmtMoney, fmtDate, fmtHours } from '../api.js';
import { StatusBar, StatusPill, Empty, COL_LABEL } from '../components/ui.jsx';
import Board from '../components/Board.jsx';
import Items from '../components/Items.jsx';
import Docs from '../components/Docs.jsx';
import Effort from '../components/Effort.jsx';
import TimeEntries from '../components/TimeEntries.jsx';
import Billing from '../components/Billing.jsx';
import Settings from '../components/Settings.jsx';

const TABS = [
  ['overview', 'Overview'], ['board', 'Board'], ['items', 'Items'], ['docs', 'Docs'],
  ['effort', 'Effort'], ['time', 'Time entries'], ['billing', 'Billing'], ['settings', 'Settings'],
];

export default function Project({ id, tab }) {
  const { data: p, error, reload } = useData(`/api/projects/${encodeURIComponent(id)}`);
  if (error) return <Empty>{error.message}</Empty>;
  if (!p) return <Empty>Loading…</Empty>;
  const s = p.summary;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{p.name}</h1>
          <div className="muted small">{p.settings.customer || 'No customer set'} · <code>{p.root}</code> · {p.bmadVersion ? `BMad ${p.bmadVersion}` : 'no BMad'} · {p.workstreams.length} workstreams</div>
        </div>
      </div>
      <nav className="tabs">
        {TABS.map(([k, label]) => (
          <a key={k} href={`#/p/${encodeURIComponent(id)}/${k}`} className={tab === k ? 'active' : ''}>{label}</a>
        ))}
      </nav>
      {tab === 'overview' && <Overview p={p} s={s} />}
      {tab === 'board' && <Board projectId={p.id} items={p.items} epics={p.epics} workstreams={p.workstreams} />}
      {tab === 'items' && <Items p={p} />}
      {tab === 'docs' && <Docs p={p} />}
      {tab === 'effort' && <Effort p={p} />}
      {tab === 'time' && <TimeEntries p={p} onChange={reload} />}
      {tab === 'billing' && <Billing p={p} />}
      {tab === 'settings' && <Settings p={p} onSaved={reload} />}
    </div>
  );
}

function Overview({ p, s }) {
  const inFlight = p.items.filter((i) => i.status === 'in-progress' || i.status === 'review');
  const recent = [...p.items].filter((i) => i.updated).sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 8);
  return (
    <div className="stack">
      {!p.configured && (
        <div className="banner">This project uses default billing settings. <a href={`#/p/${encodeURIComponent(p.id)}/settings`}>Configure billing</a> to set the customer, mode and rate.</div>
      )}
      <div className="kpis">
        <div className="kpi"><div className="kpi-v">{s.percentDone ?? '—'}{s.percentDone != null && '%'}</div><div className="kpi-l">done ({s.done}/{s.total})</div></div>
        <div className="kpi"><div className="kpi-v">{s.hoursThisMonth} h</div><div className="kpi-l">effort this month</div></div>
        <div className="kpi"><div className="kpi-v">{s.hoursTotal} h</div><div className="kpi-l">effort total · {s.sessions} sessions</div></div>
        <div className="kpi"><div className="kpi-v">{fmtMoney(s.aiCostTotal)}</div><div className="kpi-l">AI cost total</div></div>
        <div className="kpi"><div className="kpi-v">{s.bugsOpen}</div><div className="kpi-l">open bugs</div></div>
      </div>
      {s.total > 0 && <div className="card"><StatusBar counts={s.counts} /><div className="legend">{Object.entries(s.counts).map(([k, v]) => <span key={k}><i className={`dot s-${k}`} />{COL_LABEL[k]} {v}</span>)}</div></div>}

      {p.workstreams.length > 0 && (
        <div className="card">
          <h3>Workstreams</h3>
          <table className="table">
            <thead><tr><th>Workstream</th><th>Docs</th><th>Items</th><th style={{ width: '22%' }}>Progress</th><th>Effort</th><th>AI cost</th><th>Updated</th></tr></thead>
            <tbody>
              {p.workstreams.map((w) => (
                <tr key={w.id}>
                  <td><b>{w.label}</b> <span className="muted small">{w.id !== 'bmad' && w.id}</span></td>
                  <td>{w.docs}</td>
                  <td>{w.items ? <>{w.done} done · <b>{w.open} open</b></> : '—'}</td>
                  <td>{w.items > 0 && <div className="progress"><span style={{ width: `${(w.done / w.items) * 100}%` }} /></div>}</td>
                  <td>{w.minutes ? fmtHours(w.minutes) : '—'}{w.sessions ? <span className="muted small"> · {w.sessions} sessions</span> : ''}</td>
                  <td>{w.aiCost ? fmtMoney(w.aiCost) : '—'}</td>
                  <td className="muted small">{fmtAgo(w.updated)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {p.epics.length > 0 && (
        <div className="card">
          <h3>Epics</h3>
          <table className="table">
            <thead><tr><th>Epic</th><th>Status</th><th>Stories</th><th style={{ width: '35%' }}>Progress</th></tr></thead>
            <tbody>
              {p.epics.map((e) => (
                <tr key={e.number}>
                  <td>{e.number}. {e.title}</td>
                  <td><StatusPill status={e.effectiveStatus} raw={e.rawStatus} /></td>
                  <td>{e.storiesDone}/{e.stories}</td>
                  <td><div className="progress"><span style={{ width: `${e.stories ? (e.storiesDone / e.stories) * 100 : 0}%` }} /></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="two">
        <div className="card">
          <h3>In progress &amp; review ({inFlight.length})</h3>
          {inFlight.length ? <ul className="list">{inFlight.slice(0, 12).map((i) => <li key={i.id}><StatusPill status={i.status} raw={i.rawStatus} /> {i.title}</li>)}</ul> : <div className="muted">Nothing in flight.</div>}
        </div>
        <div className="card">
          <h3>Recently updated</h3>
          <ul className="list">{recent.map((i) => <li key={i.id}><span className="muted small">{fmtAgo(i.updated)}</span> {i.title}</li>)}</ul>
        </div>
      </div>

      {p.actionItems.length > 0 && (
        <div className="card">
          <h3>Retro action items ({p.actionItems.filter((a) => a.status !== 'done').length} open)</h3>
          <ul className="list">{p.actionItems.map((a) => <li key={a.id}><StatusPill status={a.status} raw={a.rawStatus} /> <span className="muted small">Epic {a.epic}</span> {a.action}</li>)}</ul>
        </div>
      )}
      <div className="muted small">Last session {fmtDate(p.summary.lastActivity)}</div>
    </div>
  );
}
