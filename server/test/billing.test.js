import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeInvoice, isWarrantyBug, invoiceCsv } from '../billing.js';
import { activeMinutes } from '../indexer/claude.js';
import { normalizeStatus } from '../indexer/bmad.js';
import { defaultSettings } from '../settings.js';

const at = (d, h, m = 0) => new Date(`${d}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`).toISOString();

function fixture(billing = {}) {
  const settings = defaultSettings('demo');
  settings.billing = { ...settings.billing, rounding_minutes: 0, ...billing };
  return {
    settings,
    epics: [{ number: 1, title: 'Auth', effectiveStatus: 'done', stories: 2, storiesDone: 2, doneAt: at('2026-11-10', 12) }],
    items: [
      { id: '1-1-login', title: 'Login', kind: 'story', status: 'done', doneAt: at('2026-11-05', 10), estimate: 3, created: at('2026-11-01', 9) },
      { id: '1-2-shell', title: 'Shell', kind: 'story', status: 'done', doneAt: at('2026-11-10', 10), estimate: null, created: at('2026-11-01', 9) },
      { id: 'fix-crash', title: 'Crash', kind: 'bug', status: 'done', doneAt: at('2026-11-12', 10), created: at('2026-11-12', 9) },
    ],
    sessions: [
      { id: 's1', start: at('2026-11-05', 9), activeMinutes: 120, cost: 1.5, itemId: '1-1-login' },
      { id: 's2', start: at('2026-11-12', 9), activeMinutes: 60, cost: 0.5, itemId: 'fix-crash' },
      { id: 's3', start: at('2026-11-13', 9), activeMinutes: 30, cost: 0.25, itemId: null },
      { id: 's4', start: at('2026-10-20', 9), activeMinutes: 600, cost: 9, itemId: null },
    ],
    timeEntries: [{ id: 't1', date: '2026-11-14', minutes: 45, kind: 'meeting', note: 'Review', billable: true }],
  };
}
const period = { from: '2026-11-01', to: '2026-11-30' };

test('status normalization', () => {
  assert.equal(normalizeStatus('ready-for-dev'), 'ready');
  assert.equal(normalizeStatus('In Progress'), 'in-progress');
  assert.equal(normalizeStatus('done'), 'done');
  assert.equal(normalizeStatus('weird'), 'backlog');
});

test('active minutes ignores idle gaps', () => {
  const t0 = Date.parse('2026-11-01T09:00:00Z');
  const ts = [t0, t0 + 2 * 60000, t0 + 5 * 60000, t0 + 65 * 60000];
  assert.equal(activeMinutes(ts, 10), 5 + 2); // 5 active min + 2 bursts
});

test('time & materials bills tracked hours in the period only', () => {
  const inv = computeInvoice(fixture({ mode: 'time_and_materials', hourly_rate: 50 }), period);
  assert.equal(inv.internal.actualHours, 4.25); // 120+60+30+45 min
  assert.equal(inv.subtotal, 212.5);
});

test('time & materials applies the cap', () => {
  const inv = computeInvoice(fixture({ mode: 'time_and_materials', hourly_rate: 50, cap_hours: 2 }), period);
  assert.equal(inv.subtotal, 100);
  assert.ok(inv.warnings.some((w) => w.includes('cap')));
});

test('rounding rounds each unit up', () => {
  const inv = computeInvoice(fixture({ mode: 'time_and_materials', hourly_rate: 60, rounding_minutes: 60 }), period);
  assert.equal(inv.subtotal, 60 * 5); // 2h + 1h + 1h + 1h
});

test('per story bills done stories by estimate and warns on missing estimate', () => {
  const inv = computeInvoice(fixture({ mode: 'per_story', per_story: { unit: 'points', rate_per_unit: 100 } }), period);
  assert.equal(inv.subtotal, 300);
  assert.ok(inv.warnings.some((w) => w.includes('Shell')));
});

test('milestone bills done epics not yet invoiced', () => {
  const inv = computeInvoice(fixture({ mode: 'milestone', milestones: [{ name: 'MVP', epic: 1, amount: 2000 }] }), period);
  assert.equal(inv.subtotal, 2000);
  const inv2 = computeInvoice(fixture({ mode: 'milestone', milestones: [{ name: 'MVP', epic: 1, amount: 2000, invoiced: true }] }), period);
  assert.equal(inv2.subtotal, 0);
});

test('retainer adds overage beyond included hours', () => {
  const inv = computeInvoice(fixture({ mode: 'retainer', retainer: { monthly_fee: 800, included_hours: 3, overage_rate: 40 } }), period);
  assert.equal(inv.subtotal, 800 + 1.25 * 40);
});

test('hybrid: fixed stories + hourly bugs + meeting not billed unless listed', () => {
  const inv = computeInvoice(fixture({ mode: 'hybrid', hourly_rate: 50, per_story: { rate_per_unit: 100, default_estimate: 1 }, hybrid: { fixed: ['story'], hourly: ['bug'] } }), period);
  assert.equal(inv.subtotal, 300 + 100 + 50); // login 3pt + shell default 1pt + 1h bug
  assert.ok(inv.warnings.some((w) => w.includes('could not be linked')));
});

test('warranty bugs are free', () => {
  const s = fixture({ mode: 'time_and_materials', hourly_rate: 50, delivered_on: '2026-11-10', bug_warranty_days: 30 });
  assert.equal(isWarrantyBug(s.items[2], s.settings.billing), true);
  const inv = computeInvoice(s, period);
  assert.equal(inv.subtotal, 212.5 - 50);
  assert.ok(inv.lines.some((l) => l.category === 'warranty'));
});

test('AI cost markup line', () => {
  const inv = computeInvoice(fixture({ mode: 'time_and_materials', hourly_rate: 0, ai_cost: 'markup', ai_markup_pct: 20 }), period);
  assert.equal(inv.subtotal, 2.7); // (1.5+0.5+0.25) * 1.2
  assert.match(invoiceCsv(inv), /AI usage/);
});
