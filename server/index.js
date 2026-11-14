import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { loadConfig, APP_ROOT } from './config.js';
import { Index } from './indexer/index.js';
import { readDoc, safePath, COLUMNS } from './indexer/bmad.js';
import { writeSettings, deepMerge, addTimeEntry, deleteTimeEntry, BILLING_MODES, ITEM_KINDS } from './settings.js';
import { computeInvoice, invoiceCsv } from './billing.js';

const config = loadConfig();
const index = new Index(config);
const app = express();
app.use(express.json({ limit: '1mb' }));

const wrap = (fn) => (req, res) => Promise.resolve().then(() => fn(req, res)).catch((e) => res.status(e.status || 500).json({ error: e.message }));
const project = (req) => {
  const p = index.get(req.params.id);
  if (!p) { const e = new Error('Project not found'); e.status = 404; throw e; }
  return p;
};
const defaultPeriod = () => {
  const now = new Date();
  const f = (d) => d.toLocaleDateString('en-CA');
  return { from: f(new Date(now.getFullYear(), now.getMonth(), 1)), to: f(new Date(now.getFullYear(), now.getMonth() + 1, 0)) };
};

app.get('/api/meta', (req, res) => res.json({
  projectsRoot: config.projectsRoot, claudeDir: config.claudeDir, lastBuilt: index.lastBuilt,
  sessionsScanned: index.allSessions.length, columns: COLUMNS, billingModes: BILLING_MODES, itemKinds: ITEM_KINDS,
  claudeDirFound: fs.existsSync(path.join(config.claudeDir, 'projects')),
}));

app.get('/api/projects', (req, res) => {
  res.json([...index.projects.values()].map((p) => index.summary(p)).sort((a, b) => (b.lastActivity || '').localeCompare(a.lastActivity || '') || a.name.localeCompare(b.name)));
});

app.get('/api/projects/:id', wrap((req, res) => {
  const p = project(req);
  const { sessions, ...rest } = p;
  res.json({ ...rest, summary: index.summary(p), sessionsCount: sessions.length });
}));

app.get('/api/projects/:id/sessions', wrap((req, res) => res.json(project(req).sessions)));

app.get('/api/projects/:id/doc', wrap((req, res) => res.json(readDoc(project(req).root, String(req.query.path || '')))));

// HTML reports (e.g. seo-audit-2026-11-13.html) are shown in a sandboxed iframe: no scripts, no same-origin access.
app.get('/api/projects/:id/raw', wrap((req, res) => {
  const full = safePath(project(req).root, String(req.query.path || ''), ['.html', '.htm']);
  res.set({ 'Content-Security-Policy': "sandbox; default-src 'none'; img-src * data:; style-src 'unsafe-inline' *; font-src * data:", 'X-Content-Type-Options': 'nosniff' });
  res.type('html').send(fs.readFileSync(full, 'utf8'));
}));

app.put('/api/projects/:id/settings', wrap((req, res) => {
  const p = project(req);
  writeSettings(p.root, deepMerge(p.settings, req.body || {}));
  res.json(index.refreshProject(p.root).settings);
}));

app.post('/api/projects/:id/time-entries', wrap((req, res) => {
  const p = project(req);
  const row = addTimeEntry(p.root, req.body || {});
  index.refreshProject(p.root);
  res.status(201).json(row);
}));

app.delete('/api/projects/:id/time-entries/:entryId', wrap((req, res) => {
  const p = project(req);
  const ok = deleteTimeEntry(p.root, req.params.entryId);
  index.refreshProject(p.root);
  res.status(ok ? 204 : 404).end();
}));

app.get('/api/projects/:id/invoice', wrap((req, res) => {
  const p = project(req);
  const period = { ...defaultPeriod(), ...(req.query.from ? { from: String(req.query.from) } : {}), ...(req.query.to ? { to: String(req.query.to) } : {}) };
  const inv = computeInvoice(p, period);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${p.id}-invoice-${period.from}_${period.to}.csv"`);
    return res.send(invoiceCsv(inv));
  }
  res.json(inv);
}));

app.post('/api/reindex', wrap(async (req, res) => { await index.rebuild(); res.json({ ok: true, at: index.lastBuilt }); }));

// Server-sent events: the UI refetches when files change.
app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders();
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  index.on('changed', send);
  req.on('close', () => { clearInterval(ping); index.off('changed', send); });
});

// Built UI (npm start). In dev, Vite serves the UI and proxies /api here.
const dist = path.join(APP_ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

await index.rebuild();
if (process.env.PMDAI_NO_WATCH !== '1') index.watch();
app.listen(config.port, '127.0.0.1', () => {
  console.log(`[pmdai] http://localhost:${config.port}  (projects: ${config.projectsRoot}, claude: ${config.claudeDir})`);
});
