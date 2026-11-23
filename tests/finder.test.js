import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seriesValues, nearestIndex, findCombos, TOPOLOGIES, formatError, formatAmount, formatQty, asResistor,
  parseValue, markingCode, layoutOf, describe, makeValue, KINDS,
} from '../js/finder.js';

const E = (kind, s) => seriesValues(kind, s);

test('series tables per kind', () => {
  assert.equal(E('resistor', 'E24')[0].label, '1 Ω');
  assert.equal(E('resistor', 'E24').at(-1).label, '10 MΩ');
  assert.equal(E('resistor', 'E12').length, 12 * 7 + 1);
  assert.equal(E('resistor', 'E96').length, 96 * 7 + 1);
  assert.equal(E('capacitor', 'E6')[0].label, '1 pF');
  assert.equal(E('capacitor', 'E6').at(-1).label, '10 mF');
  assert.equal(E('inductor', 'E12')[0].label, '10 nH');
  assert.equal(E('inductor', 'E12').at(-1).label, '1 H');
  assert.ok(E('capacitor', 'E12').some((v) => v.label === '100 nF'));
  assert.ok(E('inductor', 'E6').some((v) => v.label === '4.7 µH'));
  for (const k of Object.keys(KINDS)) for (const s of KINDS[k].series) {
    const t = E(k, s);
    for (let i = 1; i < t.length; i++) assert.ok(t[i].value > t[i - 1].value);
  }
});

test('formatting', () => {
  assert.equal(formatQty(47, 2, 'resistor'), '4.7 kΩ');
  assert.equal(formatQty(10, 4, 'capacitor'), '100 nF');
  assert.equal(formatQty(47, 2, 'inductor'), '4.7 µH');
  assert.equal(formatQty(22, 5, 'capacitor'), '2.2 µF');
  assert.equal(formatAmount(1234.6, 'resistor'), '1.235 kΩ');
  assert.equal(formatAmount(132000, 'capacitor'), '132 nF');
  assert.equal(formatAmount(36000, 'inductor'), '36 µH');
  assert.equal(formatError(0), 'exact');
  assert.equal(formatError(-2.7553), '−2.8%');
  assert.equal(formatError(0.081), '+0.081%');
});

test('parsing typed values per kind', () => {
  const R = (t, u = 0) => parseValue(t, 'resistor', u);
  const C = (t, u = 0) => parseValue(t, 'capacitor', u);
  const L = (t, u = 0) => parseValue(t, 'inductor', u);
  assert.equal(R('4.7k'), 4700);
  assert.equal(R('4k7'), 4700);
  assert.equal(R('4,7', 3), 4700);
  assert.equal(R('R47'), 0.47);
  assert.equal(R('1.5MΩ'), 1.5e6);
  assert.equal(R('1234'), 1234);
  assert.ok(Math.abs(C('100n') - 1e5) < 1e-6);
  assert.ok(Math.abs(C('100nF') - 1e5) < 1e-6);
  assert.ok(Math.abs(C('10u') - 1e7) < 1e-3);
  assert.ok(Math.abs(C('10µF') - 1e7) < 1e-3);
  assert.ok(Math.abs(C('4n7') - 4700) < 1e-9);
  assert.equal(C('22', 3), 22000);                  // 22 with nF selected
  assert.ok(Math.abs(L('2.2mH') - 2.2e6) < 1e-6);
  assert.ok(Math.abs(L('4R7') - 4700) < 1e-9);      // inductor R = µH
  assert.ok(Math.abs(L('4u7') - 4700) < 1e-9);
  assert.equal(L('1H'), 1e9);
  assert.equal(C('1F'), 1e12);
  assert.equal(R('47Ω', 3), 47);                 // explicit Ω beats the selected kΩ
  assert.ok(Number.isNaN(R('abc')));
  assert.ok(Number.isNaN(C('')));
});

test('marking codes', () => {
  assert.equal(markingCode(10, 4, 'capacitor'), '104');   // 100 nF
  assert.equal(markingCode(47, 3, 'capacitor'), '473');   // 47 nF
  assert.equal(markingCode(22, 0, 'capacitor'), '220');   // 22 pF
  assert.equal(markingCode(47, -1, 'capacitor'), '4R7');  // 4.7 pF
  assert.equal(markingCode(10, 4, 'inductor'), '101');    // 100 µH
  assert.equal(markingCode(47, 2, 'inductor'), '4R7');    // 4.7 µH
  assert.equal(markingCode(47, 1, 'inductor'), 'R47');    // 0.47 µH
  assert.equal(markingCode(102, 0, 'capacitor'), null);   // 3 significant digits
});

test('resistor parts draw with bands', () => {
  const v = E('resistor', 'E24').find((x) => x.label === '4.7 kΩ');
  assert.deepEqual(asResistor(v).bands, ['yellow', 'violet', 'red', 'gold']);
  assert.deepEqual(asResistor(E('resistor', 'E24')[0]).bands, ['brown', 'black', 'gold', 'gold']);
  const w = E('resistor', 'E96').find((x) => x.label === '4.99 kΩ');
  assert.deepEqual(asResistor(w).bands, ['yellow', 'white', 'white', 'brown', 'brown']);
  assert.deepEqual(asResistor(makeValue(1, 3)).bands, ['brown', 'black', 'red', 'gold']);  // normalized 1e3
  assert.equal(asResistor(makeValue(1234, 0)), null);    // 4 significant digits can't be banded
});

test('nearest standard value', () => {
  const e24 = E('resistor', 'E24');
  assert.equal(e24[nearestIndex(e24, 1234)].label, '1.2 kΩ');
  assert.equal(e24[nearestIndex(e24, 4600)].label, '4.7 kΩ');
  assert.equal(e24[nearestIndex(e24, 0.3)].label, '1 Ω');
});

test('capacitors combine the opposite way to resistors', () => {
  assert.equal(layoutOf('S2', 'resistor'), 'series2');
  assert.equal(layoutOf('S2', 'capacitor'), 'parallel2');
  assert.equal(layoutOf('P2', 'capacitor'), 'series2');
  assert.equal(layoutOf('SP', 'capacitor'), 'parallelSeries');
  assert.equal(layoutOf('S2', 'inductor'), 'series2');
  // 14.7 µF from E6 caps: 10 µF ∥ 4.7 µF (values add in parallel)
  const r = findCombos(14.7e6, E('capacitor', 'E6'), { kind: 'capacitor' });
  const top = r.groups[0].items[0];
  assert.equal(top.error, 0);
  assert.equal(top.layout, 'parallel2');
  assert.equal(describe(top.layout, top.parts), '4.7 µF ∥ 10 µF');
  // Two 10 nF caps in series make 5 nF.
  const s = findCombos(5000, E('capacitor', 'E6'), { kind: 'capacitor' });
  assert.ok(s.groups.some((g) => g.items.some((it) => it.layout === 'series2' && Math.abs(it.value - 5000) < 1e-9)));
});

test('combinations: correct math, fewer parts first, each group beats the last', () => {
  const cases = [
    ['resistor', [1234, 3531, 57.3, 2.5e6, 1.5, 8823, 777, 123456, 9.1e6]],
    ['capacitor', [132000, 3.3, 777, 2.5e6, 7.7e8]],
    ['inductor', [36000, 123, 5.5e6, 7.7e8]],
  ];
  for (const [kind, targets] of cases) {
    for (const series of KINDS[kind].series) {
      for (const t of targets) {
        const r = findCombos(t, E(kind, series), { kind });
        let prev = Math.abs(r.single.best.error);
        let prevCount = 1;
        for (const g of r.groups) {
          assert.ok(g.count > prevCount);
          assert.ok(Math.abs(g.items[0].error) < prev, `${kind} ${series} ${t}`);
          for (let i = 0; i < g.items.length; i++) {
            const it = g.items[i];
            assert.equal(it.parts.length, g.count);
            const again = TOPOLOGIES[it.topology].calc(it.parts.map((p) => p.value));
            assert.ok(Math.abs(again - it.value) < 1e-9 * it.value);
            assert.ok(Math.abs(((it.value - t) / t) * 100 - it.error) < 1e-9);
            if (i) assert.ok(Math.abs(it.error) >= Math.abs(g.items[i - 1].error));
          }
          prev = Math.abs(g.items[0].error);
          prevCount = g.count;
        }
      }
    }
  }
});

test('quantities limit how often a part is used', () => {
  // Own one 10 kΩ and one 22 kΩ: 5 kΩ needs two 10 kΩ in parallel, which isn't allowed.
  const one = [makeValue(10, 3, 'resistor', { qty: 1 }), makeValue(22, 3, 'resistor', { qty: 1 })];
  const r = findCombos(5000, one, { kind: 'resistor' });
  for (const g of r.groups) for (const it of g.items) {
    const used = {};
    for (const p of it.parts) used[p.key] = (used[p.key] || 0) + 1;
    for (const k in used) assert.ok(used[k] <= 1, 'used more than owned');
  }
  // With plenty of 10 kΩ, 10k ∥ 10k = 5 kΩ exactly.
  const plenty = [makeValue(10, 3, 'resistor', { qty: null }), makeValue(22, 3, 'resistor', { qty: 1 })];
  const p = findCombos(5000, plenty, { kind: 'resistor' });
  assert.equal(p.groups[0].items[0].error, 0);
});

test('empty list is handled', () => {
  const r = findCombos(1000, [], { kind: 'resistor' });
  assert.equal(r.single, null);
  assert.deepEqual(r.groups, []);
});

test('search stays fast on a phone (E96, worst cases)', () => {
  const t0 = performance.now();
  for (const t of [1234, 56789, 3.3, 8.2e6]) findCombos(t, E('resistor', 'E96'), { kind: 'resistor' });
  for (const t of [132000, 7.7e8]) findCombos(t, E('capacitor', 'E24'), { kind: 'capacitor' });
  const ms = (performance.now() - t0) / 6;
  assert.ok(ms < 150, `took ${ms.toFixed(1)} ms per search`);
});
