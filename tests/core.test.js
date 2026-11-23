// Run with: node --test   (Node 18+, no dependencies)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeBands, formatValue, breakdown, makeOptions, generateResistor, parseAnswer, sameValue,
  rangeOf, decimalString, TOLERANCE_IDS, pointsFor,
} from '../js/core.js';

// Small seeded PRNG so the fuzz tests are reproducible.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('4-band basics', () => {
  const r = decodeBands(['brown', 'black', 'red', 'gold']);
  assert.equal(r.ohms, 1000);
  assert.equal(r.label, '1 kΩ');
  assert.equal(r.tolerance, 5);
  assert.equal(decodeBands(['yellow', 'violet', 'red', 'gold']).label, '4.7 kΩ');
  assert.equal(decodeBands(['red', 'red', 'black', 'brown']).label, '22 Ω');
  assert.equal(decodeBands(['brown', 'black', 'blue', 'silver']).label, '10 MΩ');
  assert.equal(decodeBands(['orange', 'orange', 'blue', 'gold']).label, '33 MΩ');
});

test('gold and silver multipliers are exact', () => {
  const g = decodeBands(['yellow', 'violet', 'gold', 'gold']);
  assert.equal(g.ohms, 4.7);
  assert.equal(g.label, '4.7 Ω');
  const s = decodeBands(['yellow', 'violet', 'silver', 'gold']);
  assert.equal(s.ohms, 0.47);
  assert.equal(s.label, '470 mΩ');
  assert.equal(decodeBands(['brown', 'black', 'silver', 'brown']).label, '100 mΩ');
  assert.equal(decodeBands(['brown', 'black', 'gold', 'red']).label, '1 Ω');
  assert.equal(decodeBands(['red', 'red', 'silver', 'silver']).label, '220 mΩ');
});

test('5-band values', () => {
  assert.equal(decodeBands(['brown', 'black', 'black', 'red', 'brown']).label, '10 kΩ');
  assert.equal(decodeBands(['yellow', 'violet', 'black', 'black', 'brown']).label, '470 Ω');
  assert.equal(decodeBands(['brown', 'black', 'red', 'brown', 'red']).label, '1.02 kΩ');
  const r = decodeBands(['orange', 'orange', 'red', 'silver', 'green']);
  assert.equal(r.ohms, 3.32);
  assert.equal(r.label, '3.32 Ω');
  assert.equal(r.tolerance, 0.5);
  assert.equal(decodeBands(['brown', 'black', 'black', 'silver', 'violet']).label, '1 Ω');
  assert.equal(decodeBands(['white', 'violet', 'blue', 'silver', 'gray']).label, '9.76 Ω');
  assert.equal(decodeBands(['brown', 'black', 'black', 'yellow', 'blue']).label, '1 MΩ');
});

test('decimalString never uses floats', () => {
  assert.equal(decimalString(47, -2), '0.47');
  assert.equal(decimalString(1, -2), '0.01');
  assert.equal(decimalString(976, -2), '9.76');
  assert.equal(decimalString(33, 6), '33000000');
});

test('breakdown matches the spec example', () => {
  const b = breakdown(decodeBands(['brown', 'black', 'red', 'gold']));
  assert.equal(b.summary, 'Brown = 1, Black = 0, Red = ×100 → 1,000 Ω = 1 kΩ, Gold = ±5%');
  const m = breakdown(decodeBands(['yellow', 'violet', 'silver', 'gold']));
  assert.equal(m.items[2].text, '×0.01');
  assert.match(m.summary, /0\.47 Ω = 470 mΩ/);
  const plain = breakdown(decodeBands(['red', 'red', 'black', 'gold']));
  assert.equal(plain.value, '22 Ω');
});

test('ranges', () => {
  assert.equal(rangeOf(47, -1), 'milli');
  assert.equal(rangeOf(47, 1), 'ohm');
  assert.equal(rangeOf(47, 2), 'kilo');
  assert.equal(rangeOf(47, 6), 'mega');
  assert.equal(rangeOf(47, 7), null);
});

test('typed answers', () => {
  const r = decodeBands(['yellow', 'violet', 'red', 'gold']);
  for (const [t, u] of [['4.7', 'kΩ'], ['4700', 'Ω'], ['4k7', 'Ω'], ['4.7k', 'Ω'], ['4,7', 'kΩ'], ['0.0047', 'MΩ'], [' 4700 Ω', 'Ω']]) {
    assert.ok(sameValue(parseAnswer(t, u), r), `${t} ${u}`);
  }
  assert.ok(!sameValue(parseAnswer('47', 'kΩ'), r));
  const mr = decodeBands(['yellow', 'violet', 'silver', 'gold']);
  assert.ok(sameValue(parseAnswer('470', 'mΩ'), mr));
  assert.ok(sameValue(parseAnswer('R47', 'Ω'), mr));
  assert.ok(sameValue(parseAnswer('0.47', 'Ω'), mr));
  assert.ok(sameValue(parseAnswer('2M2'), decodeBands(['red', 'red', 'green', 'gold'])));
  assert.ok(Number.isNaN(parseAnswer('abc')));
  assert.ok(Number.isNaN(parseAnswer('')));
});

test('fuzz: generated resistors round-trip and options are unique with one correct', () => {
  const rng = mulberry32(42);
  const configs = [
    { bands: '4', milli: true, kilo: true, mega: true, tolerances: TOLERANCE_IDS },
    { bands: '5', milli: true, kilo: true, mega: true, tolerances: TOLERANCE_IDS },
    { bands: 'mixed', milli: false, kilo: false, mega: false, tolerances: ['gold'] },
    { bands: 'mixed', milli: true, kilo: false, mega: true, tolerances: ['brown', 'silver'] },
  ];
  for (const cfg of configs) {
    for (let i = 0; i < 3000; i++) {
      const r = generateResistor(cfg, rng);
      const back = decodeBands(r.bands);
      assert.equal(back.key, r.key);
      assert.equal(formatValue(r.sig, r.exp), r.label);
      assert.ok(cfg.tolerances.includes(r.bands.at(-1)));
      const range = rangeOf(r.sig, r.exp);
      assert.ok(range === 'ohm' || cfg[range], `range ${range} not enabled`);
      if (cfg.bands !== 'mixed') assert.equal(r.bandCount, Number(cfg.bands));

      const opts = makeOptions(r, rng);
      assert.equal(opts.length, 4);
      assert.equal(opts.filter((o) => o.correct).length, 1);
      assert.equal(new Set(opts.map((o) => o.key)).size, 4, 'duplicate value');
      assert.equal(new Set(opts.map((o) => o.label)).size, 4, 'duplicate label');
      assert.equal(opts.find((o) => o.correct).label, r.label);
      for (const o of opts.filter((x) => !x.correct)) assert.notEqual(o.label, r.label);
    }
  }
});

test('scoring', () => {
  assert.equal(pointsFor({ streak: 1, bandCount: 4 }), 100);
  assert.equal(pointsFor({ streak: 3, bandCount: 4 }), 140);
  assert.equal(pointsFor({ streak: 50, bandCount: 5, timeFraction: 1 }), 150 + 200 + 50);
});
