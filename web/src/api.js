import { useEffect, useState, useCallback } from 'react';

async function req(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

export const api = {
  get: (u) => req('GET', u),
  put: (u, b) => req('PUT', u, b),
  post: (u, b) => req('POST', u, b),
  del: (u) => req('DELETE', u),
};

// Live index version: bumps whenever the server re-indexes (file change, Claude session update).
let listeners = new Set();
let version = 0;
let es;
function ensureEvents() {
  if (es) return;
  es = new EventSource('/api/events');
  es.onmessage = () => { version++; listeners.forEach((l) => l(version)); };
}
export function useLiveVersion() {
  const [v, setV] = useState(version);
  useEffect(() => { ensureEvents(); listeners.add(setV); return () => listeners.delete(setV); }, []);
  return v;
}

/** Fetch JSON and refetch on live changes. */
export function useData(url, deps = []) {
  const live = useLiveVersion();
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const load = useCallback(() => {
    if (!url) return;
    api.get(url).then((data) => setState({ data, error: null, loading: false })).catch((error) => setState((s) => ({ ...s, error, loading: false })));
  }, [url]);
  useEffect(load, [load, live, ...deps]);
  return { ...state, reload: load };
}

export const fmtHours = (min) => `${(min / 60).toFixed(1)} h`;
export const fmtMoney = (n, cur = 'USD') => {
  try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur }).format(n || 0); } catch { return `${cur} ${(n || 0).toFixed(2)}`; }
};
export const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '—');
export const fmtAgo = (iso) => {
  if (!iso) return '—';
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
};
export const fmtTokens = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}k` : String(n || 0));

export const go = (...parts) => { window.location.hash = '/' + parts.map(encodeURIComponent).join('/'); };
