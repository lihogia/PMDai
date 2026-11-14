import React, { useEffect, useMemo, useState } from 'react';
import { marked } from 'marked';
import { api, fmtDate } from '../api.js';
import { Empty } from './ui.jsx';

const ORDER = ['PRD', 'Brief', 'Architecture', 'UX', 'Epics', 'Spec', 'Context', 'Testing', 'Backlog', 'Retro', 'Brainstorm', 'Other', 'Repo'];

export default function Docs({ p }) {
  const [sel, setSel] = useState(null);
  const [doc, setDoc] = useState(null);
  const [err, setErr] = useState(null);
  const groups = useMemo(() => {
    const g = {};
    for (const d of p.docs) (g[d.category] ||= []).push(d);
    const keys = [...ORDER.filter((k) => g[k] && k !== 'Repo'), ...Object.keys(g).filter((k) => !ORDER.includes(k)).sort(), ...(g.Repo ? ['Repo'] : [])];
    return keys.map((k) => [k, g[k].sort((a, b) => a.path.localeCompare(b.path))]);
  }, [p.docs]);

  useEffect(() => {
    const d = p.docs.find((x) => x.path === sel);
    if (!sel || d?.format === 'html') { setDoc(null); return; }
    setErr(null);
    api.get(`/api/projects/${encodeURIComponent(p.id)}/doc?path=${encodeURIComponent(sel)}`).then(setDoc).catch(setErr);
  }, [sel, p.id]);

  if (!p.docs.length) return <Empty>No markdown documents found.</Empty>;
  return (
    <div className="docs">
      <aside className="card flush doc-list">
        {groups.map(([cat, docs]) => (
          <div key={cat}>
            <div className="doc-cat">{cat} <span>{docs.length}</span></div>
            {docs.map((d) => (
              <button key={d.id} className={`doc-item ${sel === d.path ? 'active' : ''}`} onClick={() => setSel(d.path)} title={d.path}>
                <span>{d.format === 'html' && <span className="tag">HTML</span>} {d.tracker && <span className="tag tag-blue">tracker</span>} {d.title}</span>
                <span className="muted small">{fmtDate(d.updated)}</span>
              </button>
            ))}
          </div>
        ))}
      </aside>
      <article className="card doc-view">
        {err && <div className="banner warn">{err.message}</div>}
        {!sel && <div className="muted">Pick a document to read it.</div>}
        {sel && p.docs.find((x) => x.path === sel)?.format === 'html' && (
          <>
            <div className="row muted small"><code>{sel}</code><div className="spacer" /><a href={`/api/projects/${encodeURIComponent(p.id)}/raw?path=${encodeURIComponent(sel)}`} target="_blank" rel="noreferrer">Open in new tab</a></div>
            <iframe className="html-doc" sandbox="" title={sel} src={`/api/projects/${encodeURIComponent(p.id)}/raw?path=${encodeURIComponent(sel)}`} />
          </>
        )}
        {doc && sel === doc.path && (
          <>
            <div className="muted small"><code>{doc.path}</code></div>
            {Object.keys(doc.frontmatter || {}).length > 0 && (
              <div className="fm">{Object.entries(doc.frontmatter).filter(([, v]) => typeof v !== 'object' || v === null).map(([k, v]) => <span key={k}><b>{k}</b> {String(v)}</span>)}</div>
            )}
            <div className="md" dangerouslySetInnerHTML={{ __html: marked.parse(doc.content || '') }} />
          </>
        )}
      </article>
    </div>
  );
}
