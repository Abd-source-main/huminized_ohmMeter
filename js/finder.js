// Pure "Find a part" logic for resistors, capacitors and inductors: standard
// series, value parsing/formatting, nearest value, and the best 2- and 3-part
// series/parallel combinations. No DOM; tested in Node.
//
// Values are exact: sig × 10^exp in each kind's base unit (Ω, pF or nH).
import { E24, E96, decimalString, keyOf, normalize, makeResistor } from './core.js';

export const E6 = [10, 15, 22, 33, 47, 68];
export const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];
export const SERIES = { E6, E12, E24, E96 };

// sum = which physical connection simply adds values. Resistors and inductors
// add in series; capacitors add in parallel.
export const KINDS = {
  resistor: {
    name: 'resistor', title: 'Resistor', symbol: 'Ω',
    ladder: [[-3, 'mΩ'], [0, 'Ω'], [3, 'kΩ'], [6, 'MΩ'], [9, 'GΩ']],
    inputUnits: [['Ω', 0], ['kΩ', 3], ['MΩ', 6]],
    min: 1, max: 1e7, series: ['E12', 'E24', 'E96'], defaultSeries: 'E24',
    seriesTol: { E12: 5, E24: 5, E96: 1 }, tolChoices: [1, 2, 5, 10],
    sumIs: 'series', defaultValue: 1234, rUnitExp: 0,
  },
  capacitor: {
    name: 'capacitor', title: 'Capacitor', symbol: 'F',
    ladder: [[0, 'pF'], [3, 'nF'], [6, 'µF'], [9, 'mF']],
    inputUnits: [['pF', 0], ['nF', 3], ['µF', 6]],
    min: 1, max: 1e10, series: ['E6', 'E12', 'E24'], defaultSeries: 'E12',
    seriesTol: { E6: 20, E12: 10, E24: 5 }, tolChoices: [1, 5, 10, 20],
    sumIs: 'parallel', defaultValue: 132000, rUnitExp: 0,           // 132 nF
  },
  inductor: {
    name: 'inductor', title: 'Inductor', symbol: 'H',
    ladder: [[0, 'nH'], [3, 'µH'], [6, 'mH'], [9, 'H']],
    inputUnits: [['nH', 0], ['µH', 3], ['mH', 6], ['H', 9]],
    min: 10, max: 1e9, series: ['E6', 'E12', 'E24'], defaultSeries: 'E12',
    seriesTol: { E6: 20, E12: 10, E24: 5 }, tolChoices: [5, 10, 20],
    sumIs: 'series', defaultValue: 36000, rUnitExp: 3,              // 36 µH; "4R7" means 4.7 µH
  },
};

/* ---------- formatting ---------- */

const magnitude = (sig, exp) => String(sig).length - 1 + exp;

/** Exact label with the right prefix: 132000 pF → "132 nF". */
export function formatQty(sig, exp, kind = 'resistor') {
  const L = KINDS[kind].ladder;
  const mag = magnitude(sig, exp);
  let u = L[0];
  for (const step of L) if (mag >= step[0]) u = step;
  return `${decimalString(sig, exp - u[0])} ${u[1]}`;
}

/** Label for an arbitrary float value (targets): 4 significant figures. */
export function formatAmount(value, kind = 'resistor') {
  const L = KINDS[kind].ladder;
  const mag = Math.floor(Math.log10(value) + 1e-9);
  let u = L[0];
  for (const step of L) if (mag >= step[0]) u = step;
  return `${Number((value / 10 ** u[0]).toPrecision(4))} ${u[1]}`;
}

/** Error as a signed, readable percentage. */
export function formatError(e) {
  const a = Math.abs(e);
  if (a < 0.0005) return 'exact';
  const digits = a < 0.1 ? 3 : a < 1 ? 2 : a < 10 ? 1 : 0;
  return `${e > 0 ? '+' : '−'}${a.toFixed(digits)}%`;
}

/**
 * Printed marking code. Capacitors: 3 digits in pF (104 = 100 nF).
 * Inductors: 3 digits in µH (101 = 100 µH). Below 10 an "R" marks the
 * decimal point (4R7). Resistors: SMD-style code in Ω. Null if not codable.
 */
export function markingCode(sig, exp, kind) {
  const shift = kind === 'inductor' ? 3 : 0;          // inductor codes are in µH
  const n = normalize(sig, exp - shift);
  const s = String(n.sig);
  if (s.length > 2) return null;
  const mag = s.length - 1 + n.exp;
  if (mag >= 1) {
    const two = s.length === 1 ? n.sig * 10 : n.sig;
    const zeros = mag - 1;
    return zeros <= 9 ? `${two}${zeros}` : null;
  }
  const dec = decimalString(n.sig, n.exp);            // e.g. "4.7", "0.47", "1"
  if (mag === 0) return dec.includes('.') ? dec.replace('.', 'R') : `${dec}R0`;
  if (mag === -1) return dec.replace(/^0\./, 'R');
  return null;
}

/* ---------- parsing ---------- */

const PREFIX = { p: -12, n: -9, u: -6, µ: -6, μ: -6, m: -3, k: 3, K: 3, M: 6, G: 9 };
const BASE_SI = { resistor: 0, capacitor: -12, inductor: -9 };   // base unit as a power of ten

/**
 * Parse a typed value into the kind's base unit (Ω, pF, nH).
 * Accepts "4.7k", "4,7 kΩ", "100n", "100nF", "10u", "10µF", "2.2mH", "4k7",
 * "4n7", "4u7", "R47", "4R7". A bare number uses `unitExp` (the selected
 * unit, as a power of ten relative to the base unit).
 */
export function parseValue(text, kind = 'resistor', unitExp = 0) {
  let t = String(text).trim().replace(/\s+/g, '').replace(',', '.');
  const before = t;
  t = t.replace(/(Ω|ohms?|f|h)$/i, '');               // trailing unit symbol
  const hadUnit = t !== before;
  if (!t) return NaN;
  const base = BASE_SI[kind];
  // RKM: 4k7, 4n7, 4u7, R47, 4R7
  let m = t.match(/^(\d*)([pnuµμmkKMGrR])(\d+)$/);
  if (m && (m[1] || /[rR]/.test(m[2]))) {
    const num = Number(`${m[1] || '0'}.${m[3]}`);
    if (/[rR]/.test(m[2])) return num * 10 ** KINDS[kind].rUnitExp;
    return num * 10 ** (PREFIX[m[2]] - base);
  }
  m = t.match(/^(\d+(?:\.\d*)?|\.\d+)([pnuµμmkKMG])?$/);
  if (!m) return NaN;
  const num = Number(m[1]);
  if (m[2]) {
    // "m" is milli, "M" is mega; resistors have no pico/nano/micro.
    return num * 10 ** (PREFIX[m[2]] - base);
  }
  // "1H", "2F", "47Ω": a unit with no prefix means the plain SI unit.
  return hadUnit ? num * 10 ** -base : num * 10 ** unitExp;
}

/* ---------- standard values ---------- */

const cache = {};
/** Every standard value of a series across the kind's range, ascending. */
export function seriesValues(kind = 'resistor', name) {
  const K = KINDS[kind];
  name = name ?? K.defaultSeries;
  const id = `${kind}:${name}`;
  if (cache[id]) return cache[id];
  const base = SERIES[name];
  const digits = String(base[0]).length;
  const out = [];
  const d0 = Math.floor(Math.log10(K.min));
  const d1 = Math.ceil(Math.log10(K.max));
  for (let decade = d0; decade <= d1; decade++) {
    for (const sig of base) {
      const exp = decade - (digits - 1);
      const value = Number(`${sig}e${exp}`);
      if (value < K.min || value > K.max) continue;
      out.push(makeValue(sig, exp, kind));
    }
  }
  cache[id] = out;
  return out;
}

/** A value object from exact sig/exp. */
export function makeValue(sig, exp, kind = 'resistor', extra = {}) {
  return { sig, exp, value: Number(`${sig}e${exp}`), label: formatQty(sig, exp, kind), key: keyOf(sig, exp), digits: String(sig).length, ...extra };
}

/** A part as a drawable resistor (4-band for 2 digits, 5-band for 3), or null. */
export function asResistor(v, tolId) {
  const n = normalize(v.sig, v.exp);
  let { sig, exp } = n;
  if (String(sig).length === 1) { sig *= 10; exp -= 1; }
  const d = String(sig).length;
  if (d > 3 || exp < -2 || exp > 9) return null;
  const tol = tolId ?? (d === 3 ? 'brown' : 'gold');
  try { return makeResistor(sig, exp, tol, d === 3 ? 5 : 4); } catch { return null; }
}

/** Index of the value closest to x by ratio. */
export function nearestIndex(values, x) {
  let lo = 0, hi = values.length - 1;
  if (x <= values[0].value) return 0;
  if (x >= values[hi].value) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (values[mid].value <= x) lo = mid; else hi = mid;
  }
  return x / values[lo].value <= values[hi].value / x ? lo : hi;
}

function nearestLinear(values, x, from = 0, to = values.length - 1) {
  if (from > to) return -1;
  if (x <= values[from].value) return from;
  if (x >= values[to].value) return to;
  let lo = from, hi = to;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (values[mid].value <= x) lo = mid; else hi = mid;
  }
  return x - values[lo].value <= values[hi].value - x ? lo : hi;
}

export const errorPct = (actual, target) => ((actual - target) / target) * 100;

/* ---------- combinations ---------- */

const rec = (a, b) => (a * b) / (a + b);
// Abstract topologies: S = values add, P = reciprocals add.
export const TOPOLOGIES = {
  S2: { count: 2, calc: ([a, b]) => a + b },
  P2: { count: 2, calc: ([a, b]) => rec(a, b) },
  S3: { count: 3, calc: ([a, b, c]) => a + b + c },
  P3: { count: 3, calc: ([a, b, c]) => 1 / (1 / a + 1 / b + 1 / c) },
  SP: { count: 3, calc: ([a, b, c]) => rec(a + b, c) },      // (a S b) P c
  PS: { count: 3, calc: ([a, b, c]) => rec(a, b) + c },      // (a P b) S c
};

/** Physical wiring for an abstract topology. */
export function layoutOf(topology, kind) {
  const sumSeries = KINDS[kind].sumIs === 'series';
  const map = sumSeries
    ? { S2: 'series2', P2: 'parallel2', S3: 'series3', P3: 'parallel3', SP: 'seriesParallel', PS: 'parallelSeries' }
    : { S2: 'parallel2', P2: 'series2', S3: 'parallel3', P3: 'series3', SP: 'parallelSeries', PS: 'seriesParallel' };
  return map[topology];
}

export const LAYOUT_NAME = {
  series2: 'series', parallel2: 'parallel', series3: 'series', parallel3: 'parallel',
  seriesParallel: 'two in series, then parallel', parallelSeries: 'two in parallel, then series',
};

/**
 * Wiring as text: "—" joins parts in series, "∥" joins parts in parallel.
 * Parts are listed in the order the layout draws them.
 */
export function describe(layout, parts) {
  const [a, b, c] = parts.map((p) => p.label);
  switch (layout) {
    case 'series2': return `${a} — ${b}`;
    case 'parallel2': return `${a} ∥ ${b}`;
    case 'series3': return `${a} — ${b} — ${c}`;
    case 'parallel3': return `${a} ∥ ${b} ∥ ${c}`;
    case 'seriesParallel': return `(${a} — ${b}) ∥ ${c}`;
    case 'parallelSeries': return `(${a} ∥ ${b}) — ${c}`;
    default: return a;
  }
}

/**
 * Best single part plus 2- and 3-part combinations.
 * `values` is any ascending list of value objects; entries may carry `qty`
 * (null/undefined = plenty) which caps how often a value is used.
 * Groups are ordered by part count, and a larger group is included only when
 * it beats the best error of every smaller group.
 */
export function findCombos(target, values, { kind = 'resistor', perGroup = 3 } = {}) {
  const V = values;
  const n = V.length;
  if (!n) return { target, kind, single: null, groups: [] };
  const i = nearestIndex(V, target);
  const below = V[i].value <= target ? i : i - 1;
  const above = V[i].value >= target ? i : i + 1;
  const single = {
    best: { part: V[i], value: V[i].value, error: errorPct(V[i].value, target) },
    below: V[below === i ? i - 1 : below] ?? null,
    above: V[above === i ? i + 1 : above] ?? null,
  };

  const found = { 2: new Map(), 3: new Map() };
  const allowed = (idx) => {
    const count = {};
    for (const k of idx) {
      count[k] = (count[k] || 0) + 1;
      const q = V[k].qty;
      if (q != null && count[k] > q) return false;
    }
    return true;
  };
  const consider = (topology, idx) => {
    if (idx.some((k) => k < 0 || k >= n) || !allowed(idx)) return;
    const parts = idx.map((k) => V[k]);
    const value = TOPOLOGIES[topology].calc(parts.map((p) => p.value));
    const mixed = topology === 'SP' || topology === 'PS';
    const order = mixed ? [...idx.slice(0, 2)].sort((x, y) => x - y).concat(idx[2]) : [...idx].sort((x, y) => x - y);
    const key = `${topology}:${order.join(',')}`;
    if (!found[TOPOLOGIES[topology].count].has(key)) {
      found[TOPOLOGIES[topology].count].set(key, { topology, layout: layoutOf(topology, kind), parts, value, error: errorPct(value, target), count: parts.length });
    }
  };
  // Try the solved index and its neighbours (quantity limits can rule out the nearest).
  const near = (j) => [j - 1, j, j + 1];

  const lo = Math.max(0, nearestIndex(V, target / 1000) - 1);
  const hi = Math.min(n - 1, nearestIndex(V, target * 1000) + 1);

  for (let a = lo; a <= hi; a++) {
    const ra = V[a].value;
    if (ra < target) for (const b of near(nearestLinear(V, target - ra, 0, n - 1))) consider('S2', [a, b]);
    if (ra > target) for (const b of near(nearestLinear(V, 1 / (1 / target - 1 / ra), 0, n - 1))) consider('P2', [a, b]);
  }

  const best2 = Math.min(...[...found[2].values()].map((x) => Math.abs(x.error)), Infinity);
  const span = n > 300 ? 30 : 300;
  const lo3 = Math.max(0, nearestIndex(V, target / span) - 1);
  const hi3 = Math.min(n - 1, nearestIndex(V, target * span) + 1);
  for (let a = lo3; a <= hi3 && best2 > 0.01; a++) {
    const ra = V[a].value;
    for (let b = a; b <= hi3; b++) {
      const rb = V[b].value;
      const sum = ra + rb;
      const pab = rec(ra, rb);
      if (sum < target) for (const c of near(nearestLinear(V, target - sum, 0, n - 1))) consider('S3', [a, b, c]);
      if (pab > target) for (const c of near(nearestLinear(V, 1 / (1 / target - 1 / pab), 0, n - 1))) consider('P3', [a, b, c]);
      if (sum > target) for (const c of near(nearestLinear(V, 1 / (1 / target - 1 / sum), 0, n - 1))) consider('SP', [a, b, c]);
      if (pab < target) for (const c of near(nearestLinear(V, target - pab, 0, n - 1))) consider('PS', [a, b, c]);
    }
  }

  const groups = [];
  let bestSoFar = Math.abs(single.best.error);
  for (const count of [2, 3]) {
    const items = [...found[count].values()]
      .filter((x) => Math.abs(x.error) < bestSoFar - 1e-9)
      .sort((x, y) => Math.abs(x.error) - Math.abs(y.error) || spread(x) - spread(y));
    const unique = [];
    const seen = new Set();
    for (const it of items) {
      const k = it.value.toPrecision(10);
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(it);
      if (unique.length >= perGroup) break;
    }
    if (unique.length) {
      groups.push({ count, items: unique });
      bestSoFar = Math.abs(unique[0].error);
    }
  }
  return { target, kind, single, groups };
}

const spread = (x) => x.parts.reduce((s, p) => s + Math.abs(Math.log10(p.value)), 0);
