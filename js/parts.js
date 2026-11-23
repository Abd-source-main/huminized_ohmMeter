// "My parts" inventory: which resistors, capacitors and inductors the player
// owns, at which tolerance and (optionally) how many. Stored on the device as
// one small JSON document; every read is validated so a damaged or old copy
// never breaks the app.
import { normalize, keyOf } from './core.js';
import { KINDS, makeValue, seriesValues } from './finder.js';

export const PARTS_KEY = 'hom.parts.v1';
export const KIND_IDS = Object.keys(KINDS);

export const emptyInventory = () => ({ version: 1, resistor: [], capacitor: [], inductor: [] });

const KEY_RE = /^[1-9]\d{0,5}e-?\d{1,2}$/;

function cleanItem(it, kind) {
  if (!it || typeof it !== 'object' || typeof it.v !== 'string' || !KEY_RE.test(it.v)) return null;
  const { sig, exp } = splitKey(it.v);
  const K = KINDS[kind];
  const value = Number(`${sig}e${exp}`);
  if (!(value >= K.min && value <= K.max)) return null;
  const tol = Number(it.tol);
  if (!K.tolChoices.includes(tol)) return null;
  let qty = it.qty == null ? null : Math.floor(Number(it.qty));
  if (qty != null && !(qty >= 1 && qty <= 100000)) qty = null;
  return { v: keyOf(sig, exp), tol, qty };
}

/** Validate any parsed object into a clean inventory (drops bad or duplicate entries). */
export function sanitize(raw) {
  const inv = emptyInventory();
  if (!raw || typeof raw !== 'object') return inv;
  for (const kind of KIND_IDS) {
    const seen = new Set();
    for (const it of Array.isArray(raw[kind]) ? raw[kind] : []) {
      const c = cleanItem(it, kind);
      if (!c) continue;
      const id = `${c.v}|${c.tol}`;
      if (seen.has(id)) continue;
      seen.add(id);
      inv[kind].push(c);
    }
  }
  return inv;
}

export function loadInventory(storage) {
  try { return sanitize(JSON.parse(storage.getItem(PARTS_KEY) || 'null')); } catch { return emptyInventory(); }
}

export function saveInventory(storage, inv) {
  try { storage.setItem(PARTS_KEY, JSON.stringify(inv)); return true; } catch { return false; }
}

export function splitKey(key) {
  const [s, e] = key.split('e');
  return { sig: Number(s), exp: Number(e) };
}

export const keyFor = (sig, exp) => keyOf(sig, exp);

const find = (inv, kind, key, tol) => inv[kind].findIndex((x) => x.v === key && x.tol === tol);

export const hasPart = (inv, kind, key, tol) => find(inv, kind, key, tol) >= 0;

/** Add or remove a value at a tolerance. Returns true when it was added. */
export function togglePart(inv, kind, key, tol) {
  const i = find(inv, kind, key, tol);
  if (i >= 0) { inv[kind].splice(i, 1); return false; }
  const c = cleanItem({ v: key, tol, qty: null }, kind);
  if (!c) throw new Error('not a valid part');
  inv[kind].push(c);
  return true;
}

export function setQty(inv, kind, key, tol, qty) {
  const i = find(inv, kind, key, tol);
  if (i < 0) return;
  const q = qty === '' || qty == null ? null : Math.floor(Number(qty));
  inv[kind][i].qty = q != null && q >= 1 ? Math.min(q, 100000) : null;
}

/** Tolerances owned for one value, e.g. [1, 5]. */
export const ownedTols = (inv, kind, key) => inv[kind].filter((x) => x.v === key).map((x) => x.tol).sort((a, b) => a - b);

/**
 * The owned values as an ascending list for the finder. The same value at
 * several tolerances is one entry; its quantity is the total, or unlimited
 * if any of them is "plenty".
 */
export function ownedValues(inv, kind) {
  const byKey = new Map();
  for (const it of inv[kind]) {
    const cur = byKey.get(it.v) ?? { qty: 0, unlimited: false, tols: [] };
    if (it.qty == null) cur.unlimited = true; else cur.qty += it.qty;
    cur.tols.push(it.tol);
    byKey.set(it.v, cur);
  }
  return [...byKey.entries()].map(([key, c]) => {
    const { sig, exp } = normalize(...Object.values(splitKey(key)));
    return makeValue(sig, exp, kind, { qty: c.unlimited ? null : c.qty, tols: c.tols.sort((a, b) => a - b) });
  }).sort((a, b) => a.value - b.value);
}

/** Add a whole kit: every value of a series between lo and hi at one tolerance. */
export function addKit(inv, kind, series, tol, lo, hi) {
  let added = 0;
  for (const v of seriesValues(kind, series)) {
    if (v.value < lo || v.value > hi) continue;
    if (!hasPart(inv, kind, v.key, tol)) { inv[kind].push({ v: v.key, tol, qty: null }); added++; }
  }
  return added;
}

export const KITS = {
  resistor: [{ id: 'e12', label: 'E12 kit ±5%, 1 Ω – 1 MΩ', series: 'E12', tol: 5, lo: 1, hi: 1e6 },
    { id: 'e24', label: 'E24 kit ±5%, 1 Ω – 1 MΩ', series: 'E24', tol: 5, lo: 1, hi: 1e6 }],
  capacitor: [{ id: 'e6', label: 'E6 kit ±10%, 10 pF – 1000 µF', series: 'E6', tol: 10, lo: 10, hi: 1e9 }],
  inductor: [{ id: 'e12', label: 'E12 kit ±10%, 1 µH – 1 mH', series: 'E12', tol: 10, lo: 1000, hi: 1e6 }],
};

export const countParts = (inv, kind) => inv[kind].length;

/** Export as readable JSON. */
export function exportInventory(inv) {
  return JSON.stringify({ app: 'Humanized Ohm Meter', type: 'parts', ...inv }, null, 1);
}

/**
 * Import exported text. `merge` keeps current parts and adds new ones;
 * otherwise the import replaces them. Throws a readable error on bad input.
 */
export function importInventory(current, text, { merge = true } = {}) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new Error("That isn't a parts list. Export one from this app first."); }
  const incoming = sanitize(raw);
  const total = KIND_IDS.reduce((s, k) => s + incoming[k].length, 0);
  if (!total) throw new Error('No parts found in that file.');
  const next = merge ? sanitize(current) : emptyInventory();
  let added = 0;
  for (const kind of KIND_IDS) {
    for (const it of incoming[kind]) {
      const i = find(next, kind, it.v, it.tol);
      if (i >= 0) next[kind][i].qty = it.qty;
      else { next[kind].push(it); added++; }
    }
  }
  return { inv: next, added, total };
}
