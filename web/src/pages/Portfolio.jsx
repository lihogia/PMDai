import React, { useState } from 'react';
import { useData, fmtAgo, fmtMoney, go } from '../api.js';
import { StatusBar, Empty } from '../components/ui.jsx';

const MODE_LABEL = { time_and_materials: 'T&M', per_story: 'Per story', milestone: 'Milestones', retainer: 'Retainer', hybrid: 'Hybrid' };

export default function Portfolio() {
  const { data, error } = useData('/api/projects');
  const [showAll, setShowAll] = useState(false);
  if (error) return <Empty>Could not load projects: {error.message}</Empty>;
  if (!data) return <Empty>Loading…</Empty>;

  const tracked = data.filter((p) => p.bmadVersion || p.configured || p.sessions > 0 || p.total > 0 || p.workstreams.length > 0);
  const list = showAll ? data : tracked;
  const totals = list.reduce((a, p) => ({ month: a.month + p.hoursThisMonth, open: a.open + (p.total - p.done), bugs: a.bugs + p.bugsOpen }), { month: 0, open: 0, bugs: 0 });

  return (
    <div className="page">
      <div className="page-head">
        <h1>Projects</h1>
        <label className="muted small"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> show folders without BMad or Claude activity ({data.length - tracked.length})</label>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="kpi-v">{list.length}</div><div className="kpi-l">projects</div></div>
        <div className="kpi"><div className="kpi-v">{totals.month.toFixed(1)} h</div><div className="kpi-l">effort this month</div></div>
        <div className="kpi"><div className="kpi-v">{totals.open}</div><div className="kpi-l">open items</div></div>
        <div className="kpi"><div className="kpi-v">{totals.bugs}</div><div className="kpi-l">open bugs</div></div>
      </div>
      <div className="grid">
        {list.map((p) => (
          <button key={p.id} className="card project-card" onClick={() => go('p', p.id)}>
            <div className="row">
              <h3>{p.name}</h3>
              <div className="spacer" />
              {p.bmadVersion && <span className="tag">BMad {p.bmadVersion}</span>}
              <span className={`tag ${p.configured ? 'tag-blue' : ''}`} title={p.configured ? 'Billing configured' : 'Default settings - open Settings to configure'}>{MODE_LABEL[p.billingMode]}{p.configured ? '' : ' · default'}</span>
            </div>
            <div className="muted small">{p.customer || 'No customer set'} · active {fmtAgo(p.lastActivity)}</div>
            {p.total > 0 ? (
              <>
                <StatusBar counts={p.counts} />
                <div className="row small">
                  <span><b>{p.percentDone}%</b> done ({p.done}/{p.total})</span>
                  <div className="spacer" />
                  {p.bugsOpen > 0 && <span className="pill red">{p.bugsOpen} bugs</span>}
                  {p.actionItemsOpen > 0 && <span className="pill amber">{p.actionItemsOpen} actions</span>}
                </div>
              </>
            ) : <div className="muted small pad-y">No tracked items yet · {p.docs} docs</div>}
            {p.workstreams.length > 0 && <div className="row">{p.workstreams.slice(0, 6).map((w) => <span key={w.id} className="tag" style={{ marginLeft: 0 }}>{w.label}{w.open ? ` · ${w.open} open` : ''}</span>)}</div>}
            <div className="stats">
              <div><b>{p.hoursThisMonth} h</b><span>this month</span></div>
              <div><b>{p.hoursTotal} h</b><span>total</span></div>
              <div><b>{fmtMoney(p.aiCostTotal, 'USD')}</b><span>AI cost</span></div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
