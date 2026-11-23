// "Find a resistor" screen: typed value or log-scale gauge → nearest standard
// part + series/parallel combinations.
import { parseAnswer } from './core.js';
import { resistorSVG } from './render.js';
import {
  seriesValues, nearestIndex, findCombos, describe, asResistor, formatTarget, formatError, MIN_OHMS, MAX_OHMS,
} from './finder.js';

const PX = 360;                       // gauge pixels per decade
const DECADES = Math.log10(MAX_OHMS / MIN_OHMS);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const TOL = { E12: 5, E24: 5, E96: 1 };

export function initFind({ settings, save, sfx, haptic }) {
  const el = {
    input: $('#find-value'), units: $('#find-units'), msg: $('#find-msg'),
    track: $('#gauge'), scale: $('#gauge-scale'), readout: $('#gauge-readout'),
    series: $('#find-series'), best: $('#find-best'), combos: $('#find-combos'),
  };
  const st = {
    value: settings.findValue ?? 1234,
    series: settings.findSeries ?? 'E24',
    unit: 'Ω', ready: false, raf: 0, timer: 0, lastDetent: -1, lastClick: 0,
  };

  /* ---------- gauge drawing ---------- */
  const compact = (v) => {
    if (v >= 1e6) return `${v / 1e6}M`;
    if (v >= 1e3) return `${v / 1e3}k`;
    return String(v);
  };
  function drawScale() {
    const W = DECADES * PX;
    let ticks = '';
    let labels = '';
    for (let d = 0; d <= DECADES; d++) {
      for (let k = 1; k <= (d === DECADES ? 1 : 9); k++) {
        const x = ((d + Math.log10(k)) * PX).toFixed(1);
        const v = k * 10 ** d;
        if (k === 1) {
          ticks += `M${x} 30V64`;
          labels += `<text x="${x}" y="22" class="g-major">${compact(v)} Ω</text>`;
        } else if (k === 2 || k === 5) {
          ticks += `M${x} 42V64`;
          labels += `<text x="${x}" y="34" class="g-minor">${compact(v)}</text>`;
        } else ticks += `M${x} 50V64`;
      }
    }
    const dots = seriesValues(st.series)
      .map((p) => `M${(Math.log10(p.ohms / MIN_OHMS) * PX).toFixed(1)} 70h0.01`).join('');
    el.scale.innerHTML = `<svg width="${W}" height="80" viewBox="0 0 ${W} 80" aria-hidden="true">
      <path d="${ticks}" class="g-ticks"/><path d="${dots}" class="g-dots"/>${labels}</svg>`;
  }

  /* ---------- value <-> gauge ---------- */
  const valueToScroll = (v) => Math.log10(v / MIN_OHMS) * PX;
  const scrollToValue = (s) => Math.min(MAX_OHMS, Math.max(MIN_OHMS, MIN_OHMS * 10 ** (s / PX)));

  function setGauge(v) {
    st.value = v;
    el.track.scrollLeft = valueToScroll(v);
    updateReadout();
  }
  function updateReadout() {
    el.readout.textContent = formatTarget(st.value);
    el.track.setAttribute('aria-valuenow', String(Math.round(st.value * 1000) / 1000));
    el.track.setAttribute('aria-valuetext', formatTarget(st.value));
  }
  function showInInput(v) {
    const unit = v >= 1e6 ? 'MΩ' : v >= 1e3 ? 'kΩ' : 'Ω';
    const f = { 'Ω': 1, 'kΩ': 1e3, 'MΩ': 1e6 }[unit];
    el.input.value = String(Number((v / f).toPrecision(4)));
    setUnit(unit);
  }
  function setUnit(u) {
    st.unit = u;
    $$('button', el.units).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.unit === u)));
  }

  function onScroll() {
    if (st.raf) return;
    st.raf = requestAnimationFrame(() => {
      st.raf = 0;
      const v = scrollToValue(el.track.scrollLeft);
      if (Math.abs(Math.log10(v) - Math.log10(st.value)) < 0.6 / PX) return;   // our own programmatic scroll
      st.value = v;
      updateReadout();
      showInInput(v);
      el.msg.textContent = '';
      detent(v);
      schedule();
    });
  }

  // A soft click as the needle passes each standard value, like a detented dial.
  function detent(v) {
    const vals = seriesValues(st.series);
    const i = nearestIndex(vals, v);
    if (i !== st.lastDetent) {
      st.lastDetent = i;
      const now = performance.now();
      if (now - st.lastClick > 45) {
        st.lastClick = now;
        sfx.detent?.();
        if (settings.haptics && navigator.vibrate) try { navigator.vibrate(4); } catch { /* unsupported */ }
      }
    }
  }

  /* ---------- results ---------- */
  function schedule() {
    clearTimeout(st.timer);
    st.timer = setTimeout(compute, 70);
  }

  const pillClass = (e) => {
    const a = Math.abs(e);
    return a < 0.1 ? 'pill pill-great' : a < 1 ? 'pill pill-good' : a < 5 ? 'pill pill-ok' : 'pill pill-far';
  };

  function compute() {
    settings.findValue = st.value;
    settings.findSeries = st.series;
    save();
    const r = findCombos(st.value, st.series);
    const b = r.single.best;
    const tol = TOL[st.series];
    const within = Math.abs(b.error) <= tol;
    const nb = [
      r.single.below && `Next down ${r.single.below.label} (${formatError(((r.single.below.ohms - st.value) / st.value) * 100)})`,
      r.single.above && `next up ${r.single.above.label} (${formatError(((r.single.above.ohms - st.value) / st.value) * 100)})`,
    ].filter(Boolean).join(' · ');
    el.best.innerHTML = `<div class="best-card">
      <p class="best-k">Closest standard ${st.series} value for <b>${formatTarget(st.value)}</b></p>
      <div class="best-rz">${resistorSVG(asResistor(b.part), { reveal: true })}</div>
      <p class="best-v">${b.part.label} <span class="${pillClass(b.error)}">${formatError(b.error)}</span></p>
      <p class="best-n">${nb}</p>
      <p class="best-t">${b.error === 0 ? 'Exact match: one standard part does it.'
        : within ? `Within the ±${tol}% tolerance of the part itself, so one resistor is usually fine.`
          : `Outside the part's ±${tol}% tolerance. Try a combination below.`}</p>
    </div>`;

    if (!r.groups.length) {
      el.combos.innerHTML = `<p class="empty">${b.error === 0
        ? 'Nothing to combine: a single standard part is an exact match.'
        : 'No combination of 2 or 3 parts gets closer than the single part above.'}</p>`;
      return;
    }
    el.combos.innerHTML = r.groups.map((g) => `<section class="combo-group">
      <h3>${g.count} resistors <span class="note-inline">best ${formatError(g.items[0].error)}</span></h3>
      <ol class="combos">${g.items.map((it) => `<li class="combo">
        <div class="schem">${schematic(it.topology)}</div>
        <div class="combo-main">
          <p class="combo-f">${describe(it.topology, it.parts)}</p>
          <p class="combo-r">= ${formatTarget(it.ohms)} <span class="combo-kind">${KIND[it.topology]}</span></p>
        </div>
        <span class="${pillClass(it.error)}">${formatError(it.error)}</span>
      </li>`).join('')}</ol></section>`).join('');
  }

  /* ---------- events ---------- */
  el.track.addEventListener('scroll', onScroll, { passive: true });
  el.track.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.track.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
  // Mouse drag (touch scrolls natively).
  let drag = null;
  el.track.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    drag = { x: e.clientX, s: el.track.scrollLeft };
    el.track.setPointerCapture(e.pointerId);
    el.track.classList.add('dragging');
  });
  el.track.addEventListener('pointermove', (e) => { if (drag) el.track.scrollLeft = drag.s - (e.clientX - drag.x); });
  const endDrag = () => { drag = null; el.track.classList.remove('dragging'); };
  el.track.addEventListener('pointerup', endDrag);
  el.track.addEventListener('pointercancel', endDrag);

  const nudge = (factor) => {
    const v = Math.min(MAX_OHMS, Math.max(MIN_OHMS, st.value * factor));
    setGauge(v); showInInput(v); detent(v); schedule();
  };
  el.track.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 1.1 : 1.01;
    const map = { ArrowRight: big, ArrowUp: big, ArrowLeft: 1 / big, ArrowDown: 1 / big, PageUp: 10, PageDown: 0.1 };
    if (map[e.key]) { e.preventDefault(); nudge(map[e.key]); }
    if (e.key === 'Home') { e.preventDefault(); nudge(MIN_OHMS / st.value); }
    if (e.key === 'End') { e.preventDefault(); nudge(MAX_OHMS / st.value); }
  });
  $$('.gauge-step').forEach((b) => b.addEventListener('click', () => { sfx.tap(); nudge(b.dataset.step === '1' ? 1.01 : 1 / 1.01); }));

  function fromInput() {
    const text = el.input.value.trim();
    // A cleared field starts fresh in ohms, so typing "1234" means 1234 Ω.
    if (!text) { el.msg.textContent = ''; setUnit('Ω'); return; }
    const v = parseAnswer(text, st.unit);
    if (!Number.isFinite(v) || v <= 0) {
      el.msg.textContent = 'Enter a number such as 1234 or 4.7, or a code like 4k7.';
      return;
    }
    if (v < MIN_OHMS || v > MAX_OHMS) {
      el.msg.textContent = 'Standard parts here run from 1 Ω to 10 MΩ. Enter a value in that range.';
      return;
    }
    el.msg.textContent = '';
    setGauge(v);
    schedule();
  }
  el.input.addEventListener('input', fromInput);
  el.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.input.blur(); });
  $$('button', el.units).forEach((b) => b.addEventListener('click', () => { sfx.tap(); setUnit(b.dataset.unit); fromInput(); }));
  $$('button', el.series).forEach((b) => b.addEventListener('click', () => {
    sfx.tap();
    st.series = b.dataset.series;
    $$('button', el.series).forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    drawScale();
    schedule();
  }));

  /* ---------- first show (the gauge needs layout to scroll) ---------- */
  return function onShow() {
    if (!st.ready) {
      st.ready = true;
      $$('button', el.series).forEach((x) => x.setAttribute('aria-checked', String(x.dataset.series === st.series)));
      drawScale();
      showInInput(st.value);
      compute();
    }
    requestAnimationFrame(() => setGauge(st.value));
  };
}

const KIND = {
  series2: 'series', parallel2: 'parallel', series3: 'series', parallel3: 'parallel',
  seriesParallel: 'series, then parallel', parallelSeries: 'parallel, then series',
};

/* Tiny schematics: IEC resistor boxes on wires. */
function schematic(t) {
  const box = (x, y) => `<rect x="${x}" y="${y - 5}" width="22" height="10" rx="1.5"/>`;
  const W = 'class="sch" viewBox="0 0 120 44" width="120" height="44" aria-hidden="true"';
  switch (t) {
    case 'series2':
      return `<svg ${W}><path d="M2 22H118"/>${box(26, 22)}${box(72, 22)}</svg>`;
    case 'series3':
      return `<svg ${W}><path d="M2 22H118"/>${box(12, 22)}${box(49, 22)}${box(86, 22)}</svg>`;
    case 'parallel2':
      return `<svg ${W}><path d="M2 22H22M98 22H118M22 12V32M98 12V32M22 12H98M22 32H98"/>${box(49, 12)}${box(49, 32)}</svg>`;
    case 'parallel3':
      return `<svg ${W}><path d="M2 22H22M98 22H118M22 7V37M98 7V37M22 7H98M22 22H98M22 37H98"/>${box(49, 7)}${box(49, 22)}${box(49, 37)}</svg>`;
    case 'seriesParallel':
      return `<svg ${W}><path d="M2 22H14M106 22H118M14 12V32M106 12V32M14 12H106M14 32H106"/>${box(28, 12)}${box(70, 12)}${box(49, 32)}</svg>`;
    case 'parallelSeries':
      return `<svg ${W}><path d="M2 22H10M10 12V32M60 12V32M10 12H60M10 32H60M60 22H118"/>${box(24, 12)}${box(24, 32)}${box(80, 22)}</svg>`;
    default:
      return '';
  }
}
