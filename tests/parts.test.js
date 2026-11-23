import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyInventory, sanitize, loadInventory, saveInventory, togglePart, hasPart, setQty, ownedValues,
  ownedTols, addKit, exportInventory, importInventory, PARTS_KEY,
} from '../js/parts.js';
import { findCombos } from '../js/finder.js';

const memStorage = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), raw: m };
};

test('toggle adds a value at a tolerance, and toggles it off again', () => {
  const inv = emptyInventory();
  assert.equal(togglePart(inv, 'resistor', '47e2', 5), true);
  assert.ok(hasPart(inv, 'resistor', '47e2', 5));
  assert.ok(!hasPart(inv, 'resistor', '47e2', 1));
  togglePart(inv, 'resistor', '47e2', 1);
  assert.deepEqual(ownedTols(inv, 'resistor', '47e2'), [1, 5]);
  assert.equal(togglePart(inv, 'resistor', '47e2', 5), false);
  assert.deepEqual(ownedTols(inv, 'resistor', '47e2'), [1]);
});

test('kinds are stored separately', () => {
  const inv = emptyInventory();
  togglePart(inv, 'capacitor', '1e5', 10);       // 100 nF
  togglePart(inv, 'inductor', '47e2', 20);       // 4.7 µH
  assert.equal(inv.resistor.length, 0);
  assert.equal(ownedValues(inv, 'capacitor')[0].label, '100 nF');
  assert.equal(ownedValues(inv, 'inductor')[0].label, '4.7 µH');
});

test('invalid parts are refused', () => {
  const inv = emptyInventory();
  assert.throws(() => togglePart(inv, 'resistor', '47e2', 3));      // 3% isn't offered for resistors
  assert.throws(() => togglePart(inv, 'resistor', '1e9', 5));       // above 10 MΩ
  assert.throws(() => togglePart(inv, 'resistor', 'abc', 5));
});

test('owned values merge tolerances and add up quantities', () => {
  const inv = emptyInventory();
  togglePart(inv, 'resistor', '1e4', 1);
  togglePart(inv, 'resistor', '1e4', 5);
  setQty(inv, 'resistor', '1e4', 1, 2);
  setQty(inv, 'resistor', '1e4', 5, 3);
  togglePart(inv, 'resistor', '22e3', 5);
  const v = ownedValues(inv, 'resistor');
  assert.equal(v.length, 2);
  assert.equal(v[0].label, '10 kΩ');
  assert.equal(v[0].qty, 5);
  assert.deepEqual(v[0].tols, [1, 5]);
  assert.equal(v[1].qty, null);                   // never counted = plenty
  setQty(inv, 'resistor', '1e4', 1, '');
  assert.equal(ownedValues(inv, 'resistor')[0].qty, null);
});

test('find uses only owned parts', () => {
  const inv = emptyInventory();
  for (const k of ['1e3', '22e2', '47e2']) togglePart(inv, 'resistor', k, 5);
  const r = findCombos(5900, ownedValues(inv, 'resistor'), { kind: 'resistor' });
  const owned = new Set(['1 kΩ', '2.2 kΩ', '4.7 kΩ']);
  assert.ok(owned.has(r.single.best.part.label));
  for (const g of r.groups) for (const it of g.items) for (const p of it.parts) assert.ok(owned.has(p.label));
  // 4.7k + 1k + ... : 5.9 kΩ = 4.7k — 1k — ? ; at least a 2-part answer beats the single 4.7k.
  assert.ok(r.groups.length >= 1);
});

test('kits add whole series ranges once', () => {
  const inv = emptyInventory();
  assert.equal(addKit(inv, 'resistor', 'E12', 5, 1, 1e6), 12 * 6 + 1);
  assert.equal(addKit(inv, 'resistor', 'E12', 5, 1, 1e6), 0);
});

test('storage round trip and damaged data', () => {
  const s = memStorage();
  const inv = emptyInventory();
  togglePart(inv, 'capacitor', '47e3', 10);
  assert.ok(saveInventory(s, inv));
  assert.deepEqual(loadInventory(s), inv);
  s.setItem(PARTS_KEY, '{not json');
  assert.deepEqual(loadInventory(s), emptyInventory());
  s.setItem(PARTS_KEY, JSON.stringify({ resistor: [{ v: '47e2', tol: 5 }, { v: '47e2', tol: 5 }, { v: 'x', tol: 5 }, { v: '1e3', tol: 99 }], capacitor: 'oops' }));
  const fixed = loadInventory(s);
  assert.equal(fixed.resistor.length, 1);
  assert.equal(fixed.capacitor.length, 0);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('full'); } };
  assert.deepEqual(loadInventory(broken), emptyInventory());
  assert.equal(saveInventory(broken, inv), false);
});

test('export and import', () => {
  const a = emptyInventory();
  togglePart(a, 'resistor', '47e2', 5);
  togglePart(a, 'inductor', '1e4', 10);
  setQty(a, 'inductor', '1e4', 10, 4);
  const text = exportInventory(a);
  const b = emptyInventory();
  togglePart(b, 'resistor', '1e3', 5);
  const merged = importInventory(b, text, { merge: true });
  assert.equal(merged.added, 2);
  assert.equal(merged.inv.resistor.length, 2);
  assert.equal(merged.inv.inductor[0].qty, 4);
  const replaced = importInventory(b, text, { merge: false });
  assert.equal(replaced.inv.resistor.length, 1);
  assert.throws(() => importInventory(b, 'hello'), /parts list/);
  assert.throws(() => importInventory(b, '{"resistor":[]}'), /No parts/);
  assert.deepEqual(sanitize(JSON.parse(text)), a);
});
