import React, { useEffect, useState } from 'react';
import { marked } from 'marked';
import { api, fmtHours, fmtDate, fmtMoney } from '../api.js';
import { StatusPill, KindTag, ActivityTag, COL_LABEL } from './ui.jsx';

/** Item details: status, priority, and its planning/solution (spec file or tracker section). */
export default function ItemDialog({ projectId, item, onClose }) {
  const [detail, setDetail] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setDetail(null); setErr(null);
    api.get(`/api/projects/${encodeURIComponent(projectId)}/item?id=${encodeURIComponent(item.id)}`).then(setDetail).catch(setErr);
  }, [projectId, item.id]);

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const i = detail?.item || item;
  const facts = [
    ['Status', <><StatusPill status={i.status} raw={i.rawStatus} /> <ActivityTag item={i} /></>],
    ['Priority', i.priority || '—'],
    ['Type', <KindTag kind={i.kind} />],
    i.epic != null && ['Epic', i.epic],
    i.estimate != null && ['Estimate', i.estimate],
    i.tasksTotal > 0 && ['Tasks', `${i.tasksDone}/${i.tasksTotal}`],
    i.actualMinutes > 0 && ['Effort', fmtHours(i.actualMinutes)],
    i.aiCost > 0 && ['AI cost', fmtMoney(i.aiCost)],
    i.lastWorkedAt && ['Last worked on', `${fmtDate(i.lastWorkedAt)} (Claude)`],
    i.statusChangedAt && i.prevStatus && ['Status changed', `${fmtDate(i.statusChangedAt)} (from ${COL_LABEL[i.prevStatus] || i.prevStatus})`],
    i.firstSeen && i.firstSeen !== i.created && ['Added', fmtDate(i.firstSeen)],
    ['Created', fmtDate(i.created)],
    ['Updated', fmtDate(i.updated)],
  ].filter(Boolean);

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card dialog" role="dialog" aria-modal="true" aria-label={i.title} onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h3 className="dialog-t"><span className="sid">{i.shortId}</span> {i.title}</h3>
          <div className="spacer" />
          <button className="btn ghost small" onClick={onClose} aria-label="Close">✕</button>
        </div>
        <div className="muted small">{i.file || i.sprintKey}</div>
        <dl className="facts">{facts.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}</dl>
        {i.note && <p className="small"><span className="muted">Note:</span> {i.note}</p>}
        <h4>Planning / solution</h4>
        {err && <div className="banner warn">{err.message}</div>}
        {!detail && !err && <div className="muted small">Loading…</div>}
        {detail && (detail.content
          ? <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(detail.content) }} />
          : <div className="muted small">{i.file ? 'Nothing written for this item yet.' : 'No spec file yet: this story only exists in sprint-status.yaml.'}</div>)}
      </div>
    </div>
  );
}
