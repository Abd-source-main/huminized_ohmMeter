// Pure "Find a resistor" logic: standard series, nearest value, and the best
// series / parallel combinations of 2 and 3 parts. No DOM; tested in Node.
import { E24, E96, formatValue, makeResistor } from './core.js';

export const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];
export const SERIES = { E12, E24, E96 };
export const MIN_OHMS = 1;
export const MAX_OHMS = 1e7;

const cache = {};
/** Every standard value of a series from 1 Ω to 10 MΩ, ascending, with exact sig/exp. */
export function seriesValues(name = 'E24') {
  if (cache[name]) return cache[name];
  const base = SERIES[name];
  const digits = String(base[0]).length;          // 2 for E12/E24, 3 for E96
  const out = [];
  for (let decade = 0; decade <= 7; decade++) {
    for (const sig of base) {
      const exp = decade - (digits - 1);
      const ohms = Number(`${sig}e${exp}`);
      if (ohms < MIN_OHMS || ohms > MAX_OHMS) continue;
      out.push({ sig, exp, ohms, label: formatValue(sig, exp), digits });
    }
  }
  cache[name] = out;
  return out;
}

/** Index of the value closest to x (by ratio, which is what matters on a log scale). */
export function nearestIndex(values, x) {
  let lo = 0, hi = values.length - 1;
  if (x <= values[0].ohms) return 0;
  if (x >= values[hi].ohms) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (values[mid].ohms <= x) lo = mid; else hi = mid;
  }
  return x / values[lo].ohms <= values[hi].ohms / x ? lo : hi;
}

/** Linear-distance nearest (used when completing a sum or a parallel pair). */
function nearestLinear(values, x, from = 0, to = values.length - 1) {
  if (x <= values[from].ohms) return from;
  if (x >= values[to].ohms) return to;
  let lo = from, hi = to;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (values[mid].ohms <= x) lo = mid; else hi = mid;
  }
  return x - values[lo].ohms <= values[hi].ohms - x ? lo : hi;
}

export const errorPct = (actual, target) => ((actual - target) / target) * 100;
const par = (a, b) => (a * b) / (a + b);

/** A part as a drawable resistor (4-band for 2-digit series, 5-band for E96). */
export function asResistor(v, tolId) {
  return makeResistor(v.sig, v.exp, tolId ?? (v.digits === 3 ? 'brown' : 'gold'), v.digits === 3 ? 5 : 4);
}

const TOPO = {
  series2: { count: 2, calc: ([a, b]) => a + b },
  parallel2: { count: 2, calc: ([a, b]) => par(a, b) },
  series3: { count: 3, calc: ([a, b, c]) => a + b + c },
  parallel3: { count: 3, calc: ([a, b, c]) => 1 / (1 / a + 1 / b + 1 / c) },
  seriesParallel: { count: 3, calc: ([a, b, c]) => par(a + b, c) },   // (a + b) ∥ c
  parallelSeries: { count: 3, calc: ([a, b, c]) => par(a, b) + c },   // (a ∥ b) + c
};
export const TOPOLOGIES = TOPO;

export function describe(topology, parts) {
  const [a, b, c] = parts.map((p) => p.label);
  switch (topology) {
    case 'series2': return `${a} + ${b}`;
    case 'parallel2': return `${a} ∥ ${b}`;
    case 'series3': return `${a} + ${b} + ${c}`;
    case 'parallel3': return `${a} ∥ ${b} ∥ ${c}`;
    case 'seriesParallel': return `(${a} + ${b}) ∥ ${c}`;
    case 'parallelSeries': return `(${a} ∥ ${b}) + ${c}`;
    default: return a;
  }
}

/**
 * Best single part plus 2- and 3-part combinations for a target value.
 * Groups are ordered by part count; a larger group is only included when it
 * beats the best error of every smaller group, so fewer parts always come first.
 */
export function findCombos(target, seriesName = 'E24', { perGroup = 3 } = {}) {
  const V = seriesValues(seriesName);
  const n = V.length;
  const i = nearestIndex(V, target);
  const single = {
    best: { part: V[i], ohms: V[i].ohms, error: errorPct(V[i].ohms, target) },
    below: V[target >= V[i].ohms ? i : i - 1] ?? null,
    above: V[target <= V[i].ohms ? i : i + 1] ?? null,
  };
  if (single.below && single.below === V[i]) single.below = V[i - 1] ?? null;
  if (single.above && single.above === V[i]) single.above = V[i + 1] ?? null;

  const found = { 2: new Map(), 3: new Map() };
  const consider = (topology, idx) => {
    const parts = idx.map((k) => V[k]);
    const ohms = TOPO[topology].calc(parts.map((p) => p.ohms));
    const err = errorPct(ohms, target);
    const count = TOPO[topology].count;
    // Canonical key: the same parts in the same topology count once. In the mixed
    // topologies only the first two parts are interchangeable.
    const mixed = topology === 'seriesParallel' || topology === 'parallelSeries';
    const order = mixed ? [...idx.slice(0, 2)].sort((x, y) => x - y).concat(idx[2]) : [...idx].sort((x, y) => x - y);
    const key = `${topology}:${order.join(',')}`;
    if (!found[count].has(key)) found[count].set(key, { topology, parts, ohms, error: err, count });
  };

  // Only parts within a few decades of the target can matter.
  const lo = Math.max(0, nearestIndex(V, target / 1000) - 1);
  const hi = Math.min(n - 1, nearestIndex(V, target * 1000) + 1);

  // 2 parts
  for (let a = lo; a <= hi; a++) {
    const ra = V[a].ohms;
    if (ra < target) consider('series2', [a, nearestLinear(V, target - ra, a, n - 1)].sort((x, y) => x - y));
    if (ra > target) {
      const need = 1 / (1 / target - 1 / ra);
      consider('parallel2', [a, nearestLinear(V, need, lo, n - 1)].sort((x, y) => x - y));
    }
  }

  // 3 parts: fix two, solve the third with a binary search. Skip it when two
  // parts already land within 0.01%, and search a narrower band for dense series.
  const best2 = Math.min(...[...found[2].values()].map((x) => Math.abs(x.error)), Infinity);
  const span = n > 300 ? 30 : 300;
  const lo3 = Math.max(0, nearestIndex(V, target / span) - 1);
  const hi3 = Math.min(n - 1, nearestIndex(V, target * span) + 1);
  for (let a = lo3; a <= hi3 && best2 > 0.01; a++) {
    const ra = V[a].ohms;
    for (let b = a; b <= hi3; b++) {
      const rb = V[b].ohms;
      const sum = ra + rb;
      const pab = par(ra, rb);
      if (sum < target) consider('series3', [a, b, nearestLinear(V, target - sum, b, n - 1)]);
      if (pab > target) {
        const need = 1 / (1 / target - 1 / pab);
        const c = nearestLinear(V, need, b, n - 1);
        if (c >= b) consider('parallel3', [a, b, c]);
      }
      if (sum > target) consider('seriesParallel', [a, b, nearestLinear(V, 1 / (1 / target - 1 / sum), lo, n - 1)]);
      if (pab < target) consider('parallelSeries', [a, b, nearestLinear(V, target - pab, 0, n - 1)]);
    }
  }

  const groups = [];
  let bestSoFar = Math.abs(single.best.error);
  for (const count of [2, 3]) {
    const items = [...found[count].values()]
      .filter((x) => Math.abs(x.error) < bestSoFar - 1e-9)
      .sort((x, y) => Math.abs(x.error) - Math.abs(y.error) || partsTotal(x) - partsTotal(y));
    const unique = [];
    const seenOhms = new Set();
    for (const it of items) {
      const k = it.ohms.toPrecision(10);
      if (seenOhms.has(k)) continue;
      seenOhms.add(k);
      unique.push(it);
      if (unique.length >= perGroup) break;
    }
    if (unique.length) {
      groups.push({ count, items: unique });
      bestSoFar = Math.abs(unique[0].error);
    }
  }
  return { target, series: seriesName, single, groups };
}

// Tie-break: prefer combinations whose parts are closer to common values (smaller spread).
const partsTotal = (x) => x.parts.reduce((s, p) => s + Math.abs(Math.log10(p.ohms)), 0);

/** Pretty target, 3 significant figures, auto unit. */
export function formatTarget(ohms) {
  const units = [[1e6, 'MΩ'], [1e3, 'kΩ'], [1, 'Ω'], [1e-3, 'mΩ']];
  const [f, u] = units.find(([k]) => ohms >= k) ?? units[units.length - 1];
  const v = Number((ohms / f).toPrecision(4));
  return `${v} ${u}`;
}

/** Error as a signed, readable percentage. */
export function formatError(e) {
  const a = Math.abs(e);
  if (a < 0.0005) return 'exact';
  const digits = a < 0.1 ? 3 : a < 1 ? 2 : a < 10 ? 1 : 0;
  return `${e > 0 ? '+' : '−'}${a.toFixed(digits)}%`;
}
