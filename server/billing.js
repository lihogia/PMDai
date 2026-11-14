// Turns a project's effort + items into invoice lines for a period, per the billing mode in its settings.

export const localDate = (iso) => new Date(iso).toLocaleDateString('en-CA'); // YYYY-MM-DD in server TZ
const inPeriod = (date, from, to) => date && (!from || date >= from) && (!to || date <= to);
const r2 = (n) => Math.round(n * 100) / 100;
const roundUp = (min, step) => (step > 0 ? Math.ceil(min / step) * step : min);

function monthsInPeriod(from, to) {
  const months = new Set();
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  while (d <= end) { months.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setDate(d.getDate() + 1); }
  return [...months];
}

export function isWarrantyBug(item, b) {
  if (!item || item.kind !== 'bug') return false;
  if (item.warranty) return true;
  if (!b.delivered_on || !b.bug_warranty_days || !item.created) return false;
  const delivered = Date.parse(b.delivered_on);
  const created = Date.parse(item.created);
  return created >= delivered && created - delivered <= b.bug_warranty_days * 86400000;
}

/** Normalize Claude sessions + manual entries into work units in the period. */
export function workUnits({ sessions, timeEntries, items, workstreams = [] }, from, to) {
  const wsLabel = new Map(workstreams.map((w) => [w.id, w.label]));
  const byId = new Map(items.map((i) => [i.id.toLowerCase(), i]));
  const units = [];
  for (const s of sessions) {
    const date = localDate(s.start);
    if (!inPeriod(date, from, to)) continue;
    const item = s.itemId ? byId.get(s.itemId.toLowerCase()) : null;
    const ws = item?.workstream || s.workstream || null;
    units.push({ source: 'claude', date, minutes: s.activeMinutes, item, kind: item?.kind || (ws && ws !== 'bmad' ? 'workstream' : null), workstream: ws, wsLabel: wsLabel.get(ws) || ws, billable: true, cost: s.cost, ref: s.id });
  }
  for (const e of timeEntries) {
    if (!inPeriod(e.date, from, to)) continue;
    const item = e.itemId ? byId.get(String(e.itemId).toLowerCase()) : null;
    const ws = item?.workstream || e.workstream || null;
    units.push({ source: 'manual', date: e.date, minutes: e.minutes, item, kind: item?.kind || e.kind || 'task', workstream: ws, wsLabel: wsLabel.get(ws) || ws, billable: e.billable !== false, cost: 0, note: e.note, ref: e.id });
  }
  return units;
}

const prefix = (u) => (u.workstream && u.workstream !== 'bmad' ? `${u.wsLabel}: ` : '');
function hourlyLines(units, b, rate, {
  label = (u) => u.item ? prefix(u) + u.item.title
    : u.source === 'manual' ? prefix(u) + (u.note || u.kind)
    : u.workstream && u.workstream !== 'bmad' ? `${u.wsLabel} (general work)` : 'General development (unattributed)',
} = {}) {
  const groups = new Map();
  for (const u of units) {
    const key = u.item ? `item:${u.item.id}` : u.source === 'manual' ? `manual:${u.workstream}:${u.kind}:${u.note || ''}` : `ws:${u.workstream || ''}`;
    const g = groups.get(key) || { description: label(u), minutes: 0, itemId: u.item?.id || null, sources: new Set() };
    g.minutes += roundUp(u.minutes, Number(b.rounding_minutes) || 0);
    g.sources.add(u.source);
    groups.set(key, g);
  }
  return [...groups.values()]
    .sort((a, b2) => b2.minutes - a.minutes)
    .map((g) => {
      const qty = r2(g.minutes / 60);
      return { description: g.description, qty, unit: 'h', rate, amount: r2(qty * rate), category: 'time', itemId: g.itemId, sources: [...g.sources] };
    });
}

function fixedItemLines(items, b, from, to, kinds, warnings) {
  const ps = b.per_story || {};
  const rate = Number(ps.rate_per_unit) || 0;
  const lines = [];
  for (const it of items) {
    if (!kinds.includes(it.kind) || it.status !== 'done' || isWarrantyBug(it, b)) continue;
    const doneDate = it.doneAt ? localDate(it.doneAt) : null;
    if (!inPeriod(doneDate, from, to)) continue;
    const est = it.estimate ?? (ps.default_estimate != null ? Number(ps.default_estimate) : null);
    if (est == null) warnings.push(`"${it.title}" is done but has no estimate - add \`estimate:\` to its frontmatter or set a default.`);
    const qty = est ?? 0;
    lines.push({ description: `${it.storyNum ? `Story ${it.storyNum}: ` : ''}${it.title}`, qty, unit: ps.unit === 'hours' ? 'h' : 'pt', rate, amount: r2(qty * rate), category: 'fixed', itemId: it.id, doneAt: it.doneAt });
  }
  return lines;
}

export function computeInvoice(project, { from, to }) {
  const { settings, items, epics } = project;
  const b = settings.billing;
  const rate = Number(b.hourly_rate) || 0;
  const warnings = [];
  const all = workUnits(project, from, to);
  const units = all.filter((u) => u.billable);
  const warrantyUnits = units.filter((u) => isWarrantyBug(u.item, b));
  const billableUnits = units.filter((u) => !isWarrantyBug(u.item, b));
  let lines = [];
  let milestones = null;

  switch (b.mode) {
    case 'time_and_materials': {
      const use = b.include_unattributed ? billableUnits : billableUnits.filter((u) => u.item || u.workstream || u.source === 'manual');
      lines = hourlyLines(use, b, rate);
      const cap = Number(b.cap_hours);
      const hours = lines.reduce((a, l) => a + l.qty, 0);
      if (cap > 0 && hours > cap) {
        lines.push({ description: `Cap adjustment (not-to-exceed ${cap} h)`, qty: r2(-(hours - cap)), unit: 'h', rate, amount: r2(-(hours - cap) * rate), category: 'adjustment' });
        warnings.push(`Tracked ${r2(hours)} h exceeds the ${cap} h cap.`);
      }
      break;
    }
    case 'per_story': {
      lines = fixedItemLines(items, b, from, to, ['story', 'task', 'backlog'], warnings);
      const bugMin = billableUnits.filter((u) => u.kind === 'bug').reduce((a, u) => a + u.minutes, 0);
      if (bugMin > 0) warnings.push(`${r2(bugMin / 60)} h of non-warranty bug work is not billed in per-story mode. Use hybrid to bill it hourly.`);
      break;
    }
    case 'milestone': {
      milestones = (b.milestones || []).map((m) => {
        const epic = epics.find((e) => String(e.number) === String(m.epic));
        const done = epic ? epic.effectiveStatus === 'done' : false;
        const doneDate = epic?.doneAt ? localDate(epic.doneAt) : null;
        const billable = done && !m.invoiced && (!doneDate || inPeriod(doneDate, from, to));
        return { ...m, epicTitle: epic?.title || null, progress: epic ? `${epic.storiesDone}/${epic.stories}` : 'n/a', done, doneDate, billable };
      });
      lines = milestones.filter((m) => m.billable).map((m) => ({ description: `Milestone: ${m.name}${m.epicTitle ? ` (Epic ${m.epic}: ${m.epicTitle})` : ''}`, qty: 1, unit: 'ms', rate: Number(m.amount), amount: r2(Number(m.amount)), category: 'fixed' }));
      if (!(b.milestones || []).length) warnings.push('No milestones configured - add them in project settings.');
      break;
    }
    case 'retainer': {
      const rt = b.retainer || {};
      const months = monthsInPeriod(from, to);
      const fee = Number(rt.monthly_fee) || 0;
      lines.push({ description: `Monthly retainer (${months.join(', ')})`, qty: months.length, unit: 'mo', rate: fee, amount: r2(fee * months.length), category: 'fixed' });
      const minutes = billableUnits.reduce((a, u) => a + roundUp(u.minutes, Number(b.rounding_minutes) || 0), 0);
      const hours = r2(minutes / 60);
      const included = (Number(rt.included_hours) || 0) * months.length;
      if (hours > included) {
        const over = r2(hours - included);
        lines.push({ description: `Overage: ${hours} h used, ${included} h included`, qty: over, unit: 'h', rate: Number(rt.overage_rate) || rate, amount: r2(over * (Number(rt.overage_rate) || rate)), category: 'time' });
      }
      if (rt.rollover) warnings.push('Rollover of unused hours is not applied automatically yet.');
      break;
    }
    case 'hybrid': {
      const hy = b.hybrid || { fixed: ['story'], hourly: ['bug', 'change_request'] };
      lines = fixedItemLines(items, b, from, to, hy.fixed || [], warnings);
      const hourly = billableUnits.filter((u) => u.kind && (hy.hourly || []).includes(u.kind));
      lines.push(...hourlyLines(hourly, b, rate));
      const unattributed = billableUnits.filter((u) => !u.kind);
      if (unattributed.length) {
        const h = r2(unattributed.reduce((a, u) => a + u.minutes, 0) / 60);
        warnings.push(`${h} h of Claude time could not be linked to an item and is not billed. Review it in the Effort tab.`);
      }
      break;
    }
    default:
      warnings.push(`Unknown billing mode "${b.mode}".`);
  }

  if (warrantyUnits.length) {
    const h = r2(warrantyUnits.reduce((a, u) => a + u.minutes, 0) / 60);
    lines.push({ description: `Warranty bug fixes (${h} h, no charge)`, qty: h, unit: 'h', rate: 0, amount: 0, category: 'warranty' });
  }

  const aiCost = r2(all.reduce((a, u) => a + (u.cost || 0), 0));
  if (b.ai_cost === 'pass_through' && aiCost > 0) lines.push({ description: 'AI usage (at cost)', qty: 1, unit: 'lot', rate: aiCost, amount: aiCost, category: 'ai' });
  if (b.ai_cost === 'markup' && aiCost > 0) {
    const amt = r2(aiCost * (1 + (Number(b.ai_markup_pct) || 0) / 100));
    lines.push({ description: `AI usage (+${b.ai_markup_pct || 0}%)`, qty: 1, unit: 'lot', rate: amt, amount: amt, category: 'ai' });
  }

  const subtotal = r2(lines.reduce((a, l) => a + l.amount, 0));
  const actualHours = r2(all.reduce((a, u) => a + u.minutes, 0) / 60);
  return {
    period: { from, to },
    mode: b.mode,
    currency: settings.currency,
    customer: settings.customer,
    lines,
    subtotal,
    milestones,
    internal: {
      actualHours,
      claudeHours: r2(all.filter((u) => u.source === 'claude').reduce((a, u) => a + u.minutes, 0) / 60),
      manualHours: r2(all.filter((u) => u.source === 'manual').reduce((a, u) => a + u.minutes, 0) / 60),
      aiCost,
      effectiveHourlyRate: actualHours > 0 ? r2((subtotal - (b.ai_cost === 'absorb' ? aiCost : 0)) / actualHours) : null,
    },
    warnings,
  };
}

export function invoiceCsv(inv) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const rows = [['Description', 'Qty', 'Unit', 'Rate', `Amount (${inv.currency})`, 'Category']];
  for (const l of inv.lines) rows.push([l.description, l.qty, l.unit, l.rate, l.amount, l.category]);
  rows.push(['Subtotal', '', '', '', inv.subtotal, '']);
  return rows.map((r) => r.map(esc).join(',')).join('\n') + '\n';
}
