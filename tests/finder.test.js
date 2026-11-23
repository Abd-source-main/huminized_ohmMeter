import test from 'node:test';
import assert from 'node:assert/strict';
import { seriesValues, nearestIndex, findCombos, TOPOLOGIES, formatError, formatTarget, asResistor } from '../js/finder.js';

test('series tables cover 1 Ω to 10 MΩ', () => {
  const e12 = seriesValues('E12'), e24 = seriesValues('E24'), e96 = seriesValues('E96');
  assert.equal(e24[0].label, '1 Ω');
  assert.equal(e24.at(-1).label, '10 MΩ');
  assert.equal(e12.length, 12 * 7 + 1);
  assert.equal(e24.length, 24 * 7 + 1);
  assert.equal(e96.length, 96 * 7 + 1);
  assert.ok(e96.some((v) => v.label === '4.99 kΩ'));
  for (const s of [e12, e24, e96]) for (let i = 1; i < s.length; i++) assert.ok(s[i].ohms > s[i - 1].ohms);
});

test('parts draw as real resistors (4-band E24, 5-band E96)', () => {
  const v = seriesValues('E24').find((x) => x.label === '4.7 kΩ');
  assert.deepEqual(asResistor(v).bands, ['yellow', 'violet', 'red', 'gold']);
  const one = seriesValues('E24')[0];
  assert.deepEqual(asResistor(one).bands, ['brown', 'black', 'gold', 'gold']);
  const w = seriesValues('E96').find((x) => x.label === '4.99 kΩ');
  assert.deepEqual(asResistor(w).bands, ['yellow', 'white', 'white', 'brown', 'brown']);
});

test('nearest standard value', () => {
  const e24 = seriesValues('E24');
  assert.equal(e24[nearestIndex(e24, 1000)].label, '1 kΩ');
  assert.equal(e24[nearestIndex(e24, 1234)].label, '1.2 kΩ');
  assert.equal(e24[nearestIndex(e24, 4600)].label, '4.7 kΩ');
  assert.equal(e24[nearestIndex(e24, 0.3)].label, '1 Ω');
  assert.equal(e24[nearestIndex(e24, 5e7)].label, '10 MΩ');
});

test('exact match needs no combinations', () => {
  const r = findCombos(4700, 'E24');
  assert.equal(r.single.best.part.label, '4.7 kΩ');
  assert.equal(r.single.best.error, 0);
  assert.equal(r.groups.length, 0);
});

test('combinations: correct math, fewer parts first, each group beats the last', () => {
  const targets = [1234, 3.3e3 * 1.07, 57.3, 2.5e6, 1.5, 15e3 / 1.7, 777, 123456, 9.1e6];
  for (const series of ['E12', 'E24', 'E96']) {
    for (const t of targets) {
      const r = findCombos(t, series);
      let prev = Math.abs(r.single.best.error);
      let prevCount = 1;
      for (const g of r.groups) {
        assert.ok(g.count > prevCount, 'groups ordered by part count');
        assert.ok(g.items.length >= 1 && g.items.length <= 3);
        assert.ok(Math.abs(g.items[0].error) < prev, `${series} ${t}: ${g.count}-part group must beat ${prev}`);
        for (let i = 0; i < g.items.length; i++) {
          const it = g.items[i];
          assert.equal(it.parts.length, g.count);
          const recomputed = TOPOLOGIES[it.topology].calc(it.parts.map((p) => p.ohms));
          assert.ok(Math.abs(recomputed - it.ohms) < 1e-9 * it.ohms, 'stored value matches its parts');
          assert.ok(Math.abs(((it.ohms - t) / t) * 100 - it.error) < 1e-9, 'error % is correct');
          if (i) assert.ok(Math.abs(it.error) >= Math.abs(g.items[i - 1].error), 'sorted by accuracy');
        }
        prev = Math.abs(g.items[0].error);
        prevCount = g.count;
      }
    }
  }
});

test('known good answers', () => {
  // 1234 Ω from E24: 1.2 kΩ + 33 Ω = 1233 Ω (−0.08%) is a 2-part answer.
  const r = findCombos(1234, 'E24');
  assert.ok(Math.abs(r.groups[0].items[0].error) <= 0.082);
  // 2.5 MΩ: two 5.1 MΩ in parallel is 2.55 MΩ; something must beat the 2.4 MΩ single part (−4%).
  const m = findCombos(2.5e6, 'E24');
  assert.ok(m.groups.length >= 1 && Math.abs(m.groups[0].items[0].error) < 4);
});

test('formatting', () => {
  assert.equal(formatTarget(1234.6), '1.235 kΩ');
  assert.equal(formatTarget(4.7e6), '4.7 MΩ');
  assert.equal(formatError(0), 'exact');
  assert.equal(formatError(-2.7553), '−2.8%');
  assert.equal(formatError(0.081), '+0.081%');
});

test('3-part search is fast enough for a phone (E96)', () => {
  const t0 = performance.now();
  for (const t of [1234, 56789, 3.3, 8.2e6]) findCombos(t, 'E96');
  const ms = (performance.now() - t0) / 4;
  assert.ok(ms < 150, `took ${ms.toFixed(1)} ms per search`);
});
