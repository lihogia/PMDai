import React, { useMemo, useState } from 'react';
import { useData, fmtHours, fmtMoney, fmtTokens } from '../api.js';
import { Empty } from './ui.jsx';

const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA');

export default function Effort({ p }) {
  const { data: sessions } = useData(`/api/projects/${encodeURIComponent(p.id)}/sessions`);
  const [range, setRange] = useState(30);
  const byId = useMemo(() => new Map(p.items.map((i) => [i.id, i])), [p.items]);
  const wsLabel = new Map((p.workstreams || []).map((w) => [w.id, w.label]));

  const days = useMemo(() => {
    if (!sessions) return [];
    const out = [];
    const today = new Date();
    for (let d = range - 1; d >= 0; d--) {
      const dt = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d);
      out.push({ key: dt.toLocaleDateString('en-CA'), label: dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), claude: 0, manual: 0 });
    }
    const idx = new Map(out.map((o) => [o.key, o]));
    for (const s of sessions) { const o = idx.get(dayKey(s.start)); if (o) o.claude += s.activeMinutes; }
    for (const t of p.timeEntries) { const o = idx.get(t.date); if (o) o.manual += t.minutes; }
    return out;
  }, [sessions, p.timeEntries, range]);

  if (!sessions) return <Empty>Loading sessions…</Empty>;
  const max = Math.max(60, ...days.map((d) => d.claude + d.manual));
  const totalMin = days.reduce((a, d) => a + d.claude + d.manual, 0);
  const inRange = sessions.filter((s) => dayKey(s.start) >= days[0]?.key);
  const cost = inRange.reduce((a, s) => a + s.cost, 0);
  const attributed = inRange.filter((s) => s.itemId || s.workstream).reduce((a, s) => a + s.activeMinutes, 0);
  const claudeMin = inRange.reduce((a, s) => a + s.activeMinutes, 0);

  return (
    <div className="stack">
      <div className="row filters">
        {[7, 30, 90].map((n) => <button key={n} className={`btn ${range === n ? '' : 'ghost'}`} onClick={() => setRange(n)}>{n} days</button>)}
        <div className="spacer" />
        <span className="muted small">Active time = gaps between messages up to {p.settings.billing.idle_threshold_minutes} min (set in Settings)</span>
      </div>
      <div className="kpis">
        <div className="kpi"><div className="kpi-v">{fmtHours(totalMin)}</div><div className="kpi-l">effort, last {range} days</div></div>
        <div className="kpi"><div className="kpi-v">{inRange.length}</div><div className="kpi-l">Claude sessions</div></div>
        <div className="kpi"><div className="kpi-v">{claudeMin ? Math.round((attributed / claudeMin) * 100) : 0}%</div><div className="kpi-l">linked to an item or workstream</div></div>
        <div className="kpi"><div className="kpi-v">{fmtMoney(cost)}</div><div className="kpi-l">AI cost</div></div>
      </div>
      <div className="card">
        <div className="chart" role="img" aria-label="Daily effort">
          {days.map((d) => (
            <div key={d.key} className="bar" title={`${d.label}: ${fmtHours(d.claude)} Claude, ${fmtHours(d.manual)} manual`}>
              <div className="bar-stack" style={{ height: `${((d.claude + d.manual) / max) * 100}%` }}>
                {d.manual > 0 && <span className="b-manual" style={{ flexGrow: d.manual }} />}
                {d.claude > 0 && <span className="b-claude" style={{ flexGrow: d.claude }} />}
              </div>
              <div className="bar-l">{range <= 31 ? d.label.split(' ')[1] : ''}</div>
            </div>
          ))}
        </div>
        <div className="legend"><span><i className="dot b-claude" />Claude sessions</span><span><i className="dot b-manual" />Manual entries</span></div>
      </div>
      <div className="card flush">
        <table className="table">
          <thead><tr><th>Start</th><th>Active</th><th>Wall</th><th>Turns</th><th>Tokens</th><th>Cost</th><th>Linked to</th><th>First prompt</th></tr></thead>
          <tbody>
            {inRange.slice(0, 200).map((s) => (
              <tr key={s.id}>
                <td>{new Date(s.start).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                <td>{fmtHours(s.activeMinutes)}</td>
                <td className="muted">{fmtHours(s.wallMinutes)}</td>
                <td>{s.userTurns}</td>
                <td>{fmtTokens(s.tokens)}</td>
                <td>{fmtMoney(s.cost)}</td>
                <td>{s.itemId ? (byId.get(s.itemId)?.title || s.itemId) : s.workstream ? <span className="tag tag-blue">{wsLabel.get(s.workstream) || s.workstream}</span> : <span className="muted">—</span>}</td>
                <td className="clip muted" title={s.firstPrompt || ''}>{s.firstPrompt || ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!inRange.length && <Empty>No Claude sessions in this range.</Empty>}
      </div>
    </div>
  );
}
