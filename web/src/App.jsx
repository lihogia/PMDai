import React, { useEffect, useState } from 'react';
import Portfolio from './pages/Portfolio.jsx';
import Project from './pages/Project.jsx';
import { api, useData, fmtAgo } from './api.js';

function useHashRoute() {
  const parse = () => window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

export default function App() {
  const route = useHashRoute();
  const meta = useData('/api/meta');
  const [busy, setBusy] = useState(false);
  const reindex = async () => { setBusy(true); try { await api.post('/api/reindex'); } finally { setBusy(false); } };

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">PMD<span>ai</span></a>
        {route[0] === 'p' && <span className="crumb">/ {route[1].split('~').join(' / ')}</span>}
        <div className="spacer" />
        {meta.data && (
          <span className="muted small" title={`${meta.data.projectsRoot} · ${meta.data.claudeDir}`}>
            {meta.data.sessionsScanned} Claude sessions · indexed {fmtAgo(meta.data.lastBuilt)}
          </span>
        )}
        <button className="btn ghost" onClick={reindex} disabled={busy}>{busy ? 'Indexing…' : 'Re-index'}</button>
      </header>
      {meta.data && !meta.data.claudeDirFound && (
        <div className="banner warn">No Claude Code transcripts found at <code>{meta.data.claudeDir}/projects</code>. Effort tracking needs them. Set <code>claudeDir</code> in pmdai.config.json.</div>
      )}
      <main>
        {route[0] === 'p' && route[1] ? <Project id={route[1]} tab={route[2] || 'overview'} /> : <Portfolio />}
      </main>
    </div>
  );
}
