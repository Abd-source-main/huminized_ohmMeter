// "Find" tab: resistors, capacitors and inductors.
//  - Find a value: typed value or log-scale ruler → nearest standard part and
//    2-/3-part series/parallel combinations (from a standard series or from
//    the parts you own).
//  - My parts: searchable / browsable cards of standard values; one tap on a
//    tolerance adds that part to your list (stored on the device).
import { COLOR } from './core.js';
import { resistorSVG } from './render.js';
import {
  KINDS, seriesValues, nearestIndex, findCombos, describe, asResistor, formatAmount, formatError,
  parseValue, markingCode, makeValue, LAYOUT_NAME, SERIES,
} from './finder.js';
import {
  loadInventory, saveInventory, togglePart, ownedTols, setQty, ownedValues, addKit, KITS, exportInventory,
  importInventory, splitKey,
} from './parts.js';
import { normalize } from './core.js';

const PX = 360;                       // ruler pixels per decade
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const NOUN = { resistor: 'resistor', capacitor: 'capacitor', inductor: 'inductor' };
const PLURAL = { resistor: 'resistors', capacitor: 'capacitors', inductor: 'inductors' };

export function initFind({ settings, save, sfx, storage }) {
  // ----- persisted UI state (migrates the older resistor-only fields) -----
  const f = settings.find ?? {};
  for (const k of Object.keys(KINDS)) {
    f[k] = { value: KINDS[k].defaultValue, series: KINDS[k].defaultSeries, browse: KINDS[k].defaultSeries, decade: null, mine: false, ...(f[k] || {}) };
  }
  if (settings.findValue && !settings.find) { f.resistor.value = settings.findValue; f.resistor.series = settings.findSeries ?? 'E24'; }
  f.kind = KINDS[f.kind] ? f.kind : 'resistor';
  f.view = f.view === 'parts' ? 'parts' : 'find';
  settings.find = f;
  delete settings.findValue; delete settings.findSeries;

  let inv = loadInventory(storage);
  const persist = () => { saveInventory(storage, inv); askPersistentStorage(); };
  const persistSettings = () => save();

  const el = {
    title: $('#find-title'), kind: $('#find-kind'), view: $('#find-view'), count: $('#parts-count'),
    findPane: $('#find-pane'), partsPane: $('#parts-pane'), lede: $('#find-lede'),
    input: $('#find-value'), units: $('#find-units'), msg: $('#find-msg'),
    track: $('#gauge'), scale: $('#gauge-scale'), readout: $('#gauge-readout'),
    series: $('#find-series'), seriesHint: $('#series-hint'), best: $('#find-best'), combos: $('#find-combos'),
    pLede: $('#parts-lede'), search: $('#parts-search'), pSeries: $('#parts-series'), decades: $('#parts-decades'),
    mine: $('#parts-mine'), status: $('#parts-status'), grid: $('#parts-grid'), summary: $('#parts-summary'),
    kits: $('#parts-kits'), file: $('#parts-file'),
  };
  const st = { unitExp: 0, ready: false, raf: 0, timer: 0, lastDetent: -1, lastClick: 0 };
  const K = () => KINDS[f.kind];
  const cur = () => f[f.kind];

  /* =================== shared =================== */
  function setRadio(group, attr, value) {
    $$('button', group).forEach((b) => b.setAttribute('aria-checked', String(b.dataset[attr] === value)));
  }

  function updateCount() {
    const n = inv[f.kind].length;
    el.count.textContent = n ? String(n) : '';
    el.summary.textContent = n
      ? `${n} ${n === 1 ? 'entry' : 'entries'} in your ${NOUN[f.kind]} list (${ownedValues(inv, f.kind).length} different values).`
      : `Your ${NOUN[f.kind]} list is empty.`;
  }

  function applyKind() {
    setRadio(el.kind, 'kind', f.kind);
    setRadio(el.view, 'view', f.view);
    el.title.textContent = f.view === 'find' ? `Find a ${NOUN[f.kind]}` : `My ${PLURAL[f.kind]}`;
    el.findPane.hidden = f.view !== 'find';
    el.partsPane.hidden = f.view !== 'parts';
    updateCount();
    if (f.view === 'find') showFind(); else showParts();
  }

  el.kind.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sfx.tap(); f.kind = b.dataset.kind; persistSettings(); applyKind();
  });
  el.view.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sfx.tap(); f.view = b.dataset.view; persistSettings(); applyKind();
  });

  let persistAsked = false;
  function askPersistentStorage() {
    if (persistAsked) return;
    persistAsked = true;
    try { navigator.storage?.persist?.(); } catch { /* not supported */ }
  }

  /* =================== Find a value =================== */
  const values = () => (cur().series === 'mine' ? ownedValues(inv, f.kind) : seriesValues(f.kind, cur().series));
  const minV = () => K().min;
  const maxV = () => K().max;
  const decades = () => Math.log10(maxV() / minV());

  function showFind() {
    const k = K();
    el.lede.textContent = f.kind === 'capacitor'
      ? 'Need a capacitance you can\'t buy? Enter it to see the closest standard part and combinations that get closer. Capacitors add up in parallel.'
      : `Need a value you can't buy? Enter it to see the closest standard part, plus series and parallel combinations that get closer.`;
    el.input.placeholder = { resistor: 'e.g. 1234 or 4k7', capacitor: 'e.g. 132n or 4.7u', inductor: 'e.g. 36u or 4R7' }[f.kind];
    el.units.innerHTML = k.inputUnits.map(([label]) => `<button type="button" role="radio" data-unit="${label}">${label}</button>`).join('');
    el.units.style.gridTemplateColumns = `repeat(${k.inputUnits.length}, minmax(0, 1fr))`;
    el.series.innerHTML = [...k.series, 'mine'].map((s) => `<button type="button" role="radio" data-series="${s}">${s === 'mine' ? 'My parts' : s}</button>`).join('');
    setRadio(el.series, 'series', cur().series);
    el.track.setAttribute('aria-valuemin', String(minV()));
    el.track.setAttribute('aria-valuemax', String(maxV()));
    seriesHint();
    drawScale();
    showInInput(cur().value);
    compute();
    requestAnimationFrame(() => setGauge(cur().value));
  }

  const HINT = {
    resistor: 'Standard values you can buy. E24 is the usual 5% kit.',
    capacitor: 'Standard values you can buy. E6 and E12 are the common ones.',
    inductor: 'Standard values you can buy. E12 is the most common.',
  };
  function seriesHint() {
    el.seriesHint.textContent = cur().series === 'mine' ? `Only the ${PLURAL[f.kind]} in your list.` : HINT[f.kind];
  }

  /* ----- "What are E-series?" explainer ----- */
  const SERIES_INFO = {
    resistor: [
      ['E12', '±10% (often sold as ±5%)', 'You have a small or basic kit.'],
      ['E24', '±5%', 'You have a standard 5% carbon-film kit. Most hobby kits are this.'],
      ['E96', '±1%', 'You use 1% metal-film parts, for accurate circuits.'],
    ],
    capacitor: [
      ['E6', '±20%', 'Electrolytic and basic ceramic capacitors. Most big values only come in E6.'],
      ['E12', '±10%', 'Ceramic and film capacitors. A good default for small values.'],
      ['E24', '±5%', 'Precision film or C0G ceramics, for filters and timing.'],
    ],
    inductor: [
      ['E6', '±20%', 'Power inductors and chokes.'],
      ['E12', '±10%', 'Most fixed inductors. A good default.'],
      ['E24', '±5%', 'Precision RF inductors.'],
    ],
  };
  const decadeDigits = (s) => SERIES[s].map((n) => (String(n).length === 2 ? `${String(n)[0]}.${String(n)[1]}` : `${String(n)[0]}.${String(n).slice(1)}`));
  function openSeriesInfo() {
    const kind = f.kind;
    const k = K();
    const unit = k.ladder.find((x) => x[0] === 0)?.[1] ?? '';
    const [s0, s1] = k.series;
    const first = decadeDigits(s0);
    const names = k.series.slice(0, -1).join(', ') + ' and ' + k.series.at(-1);
    $('#series-info-title').textContent = `What are ${names}?`;
    $('#series-info-content').innerHTML = `
      <p>Shops don't sell every value. ${PLURAL[kind][0].toUpperCase() + PLURAL[kind].slice(1)} are made in standard lists called <b>E-series</b>.
        The number is how many values the list has in each step of ten: for example between 10 and 100 ${unit}. The same values then repeat ×10, ×100, and so on.</p>
      <p>More values means a single part lands closer to what you need, but those parts are more precise and cost more.</p>
      <div class="table-wrap"><table class="info-table">
        <thead><tr><th scope="col">Series</th><th scope="col">Values per ×10</th><th scope="col">Usual tolerance</th><th scope="col">Pick it if…</th></tr></thead>
        <tbody>${SERIES_INFO[kind].map(([s, tol, use]) => `<tr><th scope="row">${s}</th><td>${s.slice(1)}</td><td>${tol}</td><td>${use}</td></tr>`).join('')}</tbody>
      </table></div>
      <p class="info-k">One step of ten in ${s0} (×1, ×10, ×100 …):</p>
      <p class="info-vals">${first.map((v) => `<span>${v}</span>`).join('')}</p>
      <p class="info-k">${s1} adds the values in between (highlighted):</p>
      <p class="info-vals">${decadeDigits(s1).map((v) => `<span${first.includes(v) ? '' : ' class="is-new"'}>${v}</span>`).join('')}</p>
      <p><b>My parts</b> skips the standard lists and searches only the ${PLURAL[kind]} you've added to your list.</p>
      <p class="info-k">Not sure? Use ${k.defaultSeries}.</p>`;
    const dlg = $('#series-info');
    if (typeof dlg.showModal === 'function') dlg.showModal(); else dlg.setAttribute('open', '');
    // Start at the top with the title focused (not the "Got it" button at the bottom).
    dlg.scrollTop = 0;
    $('#series-info-title').focus({ preventScroll: true });
  }
  $$('[data-info="series"]').forEach((b) => b.addEventListener('click', () => { sfx.tap(); openSeriesInfo(); }));
  $('#series-info').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });

  function compactLabel(v) {
    const L = K().ladder;
    const mag = Math.floor(Math.log10(v) + 1e-9);
    let u = L[0];
    for (const s of L) if (mag >= s[0]) u = s;
    return { n: Number((v / 10 ** u[0]).toPrecision(3)), unit: u[1] };
  }

  function drawScale() {
    const D = decades();
    const W = D * PX;
    const start = Math.log10(minV());
    let ticks = '', labels = '';
    for (let d = 0; d <= D; d++) {
      for (let m = 1; m <= (d === D ? 1 : 9); m++) {
        const x = ((d + Math.log10(m)) * PX).toFixed(1);
        const v = m * 10 ** (d + start);
        const c = compactLabel(v);
        if (m === 1) { ticks += `M${x} 30V64`; labels += `<text x="${x}" y="22" class="g-major">${c.n} ${c.unit}</text>`; }
        else if (m === 2 || m === 5) { ticks += `M${x} 42V64`; labels += `<text x="${x}" y="34" class="g-minor">${c.n}</text>`; }
        else ticks += `M${x} 50V64`;
      }
    }
    const dots = values().map((p) => `M${(Math.log10(p.value / minV()) * PX).toFixed(1)} 70h0.01`).join('');
    el.scale.innerHTML = `<svg width="${W}" height="80" viewBox="0 0 ${W} 80" aria-hidden="true"><path d="${ticks}" class="g-ticks"/><path d="${dots}" class="g-dots"/>${labels}</svg>`;
  }

  const valueToScroll = (v) => Math.log10(v / minV()) * PX;
  const scrollToValue = (s) => Math.min(maxV(), Math.max(minV(), minV() * 10 ** (s / PX)));

  function setGauge(v) {
    cur().value = v;
    el.track.scrollLeft = valueToScroll(v);
    updateReadout();
  }
  function updateReadout() {
    const t = formatAmount(cur().value, f.kind);
    el.readout.textContent = t;
    el.track.setAttribute('aria-valuenow', String(cur().value));
    el.track.setAttribute('aria-valuetext', t);
  }
  function showInInput(v) {
    const units = K().inputUnits;
    let u = units[0];
    for (const x of units) if (v >= 10 ** x[1] * 0.9999) u = x;
    el.input.value = String(Number((v / 10 ** u[1]).toPrecision(4)));
    setUnit(u[0]);
  }
  function setUnit(label) {
    const u = K().inputUnits.find((x) => x[0] === label) ?? K().inputUnits[0];
    st.unitExp = u[1];
    setRadio(el.units, 'unit', u[0]);
  }

  function onScroll() {
    if (st.raf) return;
    st.raf = requestAnimationFrame(() => {
      st.raf = 0;
      const v = scrollToValue(el.track.scrollLeft);
      if (Math.abs(Math.log10(v) - Math.log10(cur().value)) < 0.6 / PX) return;   // our own programmatic scroll
      cur().value = v;
      updateReadout();
      showInInput(v);
      el.msg.textContent = '';
      detent(v);
      schedule();
    });
  }

  function detent(v) {
    const vals = values();
    if (!vals.length) return;
    const i = nearestIndex(vals, v);
    if (i === st.lastDetent) return;
    st.lastDetent = i;
    const now = performance.now();
    if (now - st.lastClick > 45) {
      st.lastClick = now;
      sfx.detent?.();
      if (settings.haptics && navigator.vibrate) try { navigator.vibrate(4); } catch { /* unsupported */ }
    }
  }

  function schedule() { clearTimeout(st.timer); st.timer = setTimeout(compute, 70); }

  const pill = (e) => {
    const a = Math.abs(e);
    const c = a < 0.1 ? 'pill-great' : a < 1 ? 'pill-good' : a < 5 ? 'pill-ok' : 'pill-far';
    return `<span class="pill ${c}">${formatError(e)}</span>`;
  };

  function partVisual(v, kind, reveal = true) {
    if (kind === 'resistor') {
      const r = asResistor(v);
      if (r) return `<div class="best-rz">${resistorSVG(r, { reveal })}</div>`;
    }
    const code = markingCode(v.sig, v.exp, kind);
    return code ? `<p class="best-code">Marked <b>${code}</b> on the part${kind === 'capacitor' ? ' (code in pF)' : ' (code in µH)'}</p>` : '';
  }

  function compute() {
    persistSettings();
    const kind = f.kind;
    const vals = values();
    if (!vals.length) {
      el.best.innerHTML = `<div class="best-card"><p class="best-t">Your ${NOUN[kind]} list is empty. Add the parts you own and Find will only use those.</p>
        <button type="button" class="btn btn-primary" data-go="parts">Add my ${PLURAL[kind]}</button></div>`;
      el.combos.innerHTML = '';
      return;
    }
    const target = cur().value;
    const r = findCombos(target, vals, { kind });
    const b = r.single.best;
    const mine = cur().series === 'mine';
    const tol = mine ? Math.min(...b.part.tols) : K().seriesTol[cur().series];
    const within = Math.abs(b.error) <= tol;
    const pct = (p) => formatError(((p.value - target) / target) * 100);
    const nb = [r.single.below && `Next down ${r.single.below.label} (${pct(r.single.below)})`,
      r.single.above && `next up ${r.single.above.label} (${pct(r.single.above)})`].filter(Boolean).join(' · ');
    el.best.innerHTML = `<div class="best-card">
      <p class="best-k">Closest ${mine ? 'part you have' : `standard ${cur().series} value`} for <b>${formatAmount(target, kind)}</b></p>
      ${partVisual(b.part, kind)}
      <p class="best-v">${b.part.label} ${pill(b.error)}</p>
      <p class="best-n">${nb}</p>
      <p class="best-t">${b.error === 0 ? 'Exact match: one part does it.'
        : within ? `Within the ±${tol}% tolerance of the part itself, so one part is usually fine.`
          : `Outside the part's ±${tol}% tolerance. Try a combination below.`}</p>
    </div>`;
    if (!r.groups.length) {
      el.combos.innerHTML = `<p class="empty">${b.error === 0 ? 'Nothing to combine: a single part is an exact match.'
        : `No combination of 2 or 3 ${mine ? 'of your ' : ''}parts gets closer than the single part above.`}</p>`;
      return;
    }
    el.combos.innerHTML = r.groups.map((g) => `<section class="combo-group">
      <h3>${g.count} ${PLURAL[kind]} <span class="note-inline">best ${formatError(g.items[0].error)}</span></h3>
      <ol class="combos">${g.items.map((it) => {
        const parts = orderForLayout(it);
        return `<li class="combo">
          <div class="schem">${schematic(it.layout, kind)}</div>
          <div class="combo-main">
            <p class="combo-f">${describe(it.layout, parts)}</p>
            <p class="combo-r">= ${formatAmount(it.value, kind)} <span class="combo-kind">${LAYOUT_NAME[it.layout]}</span></p>
          </div>
          ${pill(it.error)}
        </li>`;
      }).join('')}</ol></section>`).join('');
  }

  // For capacitors the "PS"/"SP" abstract order maps onto the mirrored layout;
  // the grouped pair is always listed first so the text matches the drawing.
  const orderForLayout = (it) => it.parts;

  /* ----- find events ----- */
  el.track.addEventListener('scroll', onScroll, { passive: true });
  el.track.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { el.track.scrollLeft += e.deltaY; e.preventDefault(); }
  }, { passive: false });
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
    const v = Math.min(maxV(), Math.max(minV(), cur().value * factor));
    setGauge(v); showInInput(v); detent(v); schedule();
  };
  el.track.addEventListener('keydown', (e) => {
    const big = e.shiftKey ? 1.1 : 1.01;
    const map = { ArrowRight: big, ArrowUp: big, ArrowLeft: 1 / big, ArrowDown: 1 / big, PageUp: 10, PageDown: 0.1 };
    if (map[e.key]) { e.preventDefault(); nudge(map[e.key]); }
    if (e.key === 'Home') { e.preventDefault(); nudge(minV() / cur().value); }
    if (e.key === 'End') { e.preventDefault(); nudge(maxV() / cur().value); }
  });
  $$('.gauge-step').forEach((b) => b.addEventListener('click', () => { sfx.tap(); nudge(b.dataset.step === '1' ? 1.01 : 1 / 1.01); }));

  function fromInput() {
    const text = el.input.value.trim();
    if (!text) { el.msg.textContent = ''; setUnit(K().inputUnits[0][0]); return; }
    const v = parseValue(text, f.kind, st.unitExp);
    if (!Number.isFinite(v) || v <= 0) {
      el.msg.textContent = { resistor: 'Enter a number such as 1234 or 4.7, or a code like 4k7.',
        capacitor: 'Enter a number such as 100 with a unit, or a value like 100n or 4.7u.',
        inductor: 'Enter a number such as 36 with a unit, or a value like 36u or 4R7.' }[f.kind];
      return;
    }
    if (v < minV() * 0.9999 || v > maxV() * 1.0001) {
      el.msg.textContent = `Standard ${PLURAL[f.kind]} here run from ${formatAmount(minV(), f.kind)} to ${formatAmount(maxV(), f.kind)}.`;
      return;
    }
    el.msg.textContent = '';
    setGauge(v);
    schedule();
  }
  el.input.addEventListener('input', fromInput);
  el.input.addEventListener('keydown', (e) => { if (e.key === 'Enter') el.input.blur(); });
  el.units.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sfx.tap(); setUnit(b.dataset.unit); fromInput();
  });
  el.series.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sfx.tap();
    cur().series = b.dataset.series;
    setRadio(el.series, 'series', cur().series);
    seriesHint(); drawScale(); compute();
  });
  el.best.addEventListener('click', (e) => {
    if (e.target.closest('[data-go="parts"]')) { f.view = 'parts'; persistSettings(); applyKind(); }
  });

  /* =================== My parts =================== */
  const PAGE = 60;

  function showParts() {
    const k = K();
    el.pLede.textContent = `Tap a tolerance on a card to add that ${NOUN[f.kind]} to your list. Then pick "My parts" in Find to search only what you own.`;
    el.search.placeholder = { resistor: 'Search: 47, 4.7k, 4k7, 220', capacitor: 'Search: 47, 100n, 4.7u, 104', inductor: 'Search: 47, 10u, 4R7, 2.2m' }[f.kind];
    el.pSeries.innerHTML = k.series.map((s) => `<button type="button" role="radio" data-series="${s}">${s}</button>`).join('');
    $('#browse-hint').textContent = `Which standard list of ${NOUN[f.kind]} values to show.`;
    setRadio(el.pSeries, 'series', cur().browse);
    el.mine.checked = !!cur().mine;
    const start = Math.floor(Math.log10(k.min));
    const end = Math.ceil(Math.log10(k.max)) - 1;
    if (cur().decade == null || cur().decade < start || cur().decade > end) {
      cur().decade = Math.min(end, Math.max(start, Math.floor(Math.log10(k.defaultValue))));
    }
    let chips = '';
    for (let d = start; d <= end; d++) {
      const c = compactLabel(10 ** d);
      chips += `<button type="button" class="decade" data-decade="${d}" aria-pressed="${d === cur().decade}">${c.n} ${c.unit}</button>`;
    }
    el.decades.innerHTML = chips;
    el.kits.innerHTML = KITS[f.kind].map((kit) => `<button type="button" class="btn btn-ghost" data-kit="${kit.id}">Add ${esc(kit.label)}</button>`).join('');
    renderParts();
  }

  /** The cards to show for the current search / range / filter. */
  function partList() {
    const kind = f.kind;
    const q = el.search.value.trim();
    const owned = ownedValues(inv, kind);
    const ownedKeys = new Set(owned.map((v) => v.key));
    const browse = seriesValues(kind, cur().browse);
    let list;
    let custom = null;
    if (q) {
      const digitsOnly = /^[\d.]+$/.test(q);
      if (digitsOnly && !/^\d{3}$/.test(q)) {
        // "47" or "4.7": every value whose significant digits start with 47.
        const pat = q.replace('.', '').replace(/^0+/, '').replace(/0+$/, '');
        const pool = new Map([...browse, ...owned].map((v) => [v.key, v]));
        list = [...pool.values()].filter((v) => String(normalize(v.sig, v.exp).sig).startsWith(pat)).sort((a, b) => a.value - b.value);
      } else {
        // An exact value ("4.7k", "100n", "104" for capacitors): nearest standard values + the exact one.
        let v = parseValue(q, kind, 0);
        if (/^\d{3}$/.test(q) && kind !== 'resistor') v = codeToValue(q, kind);
        else if (/^\d{3}$/.test(q)) v = Number(q);
        if (Number.isFinite(v) && v >= KINDS[kind].min && v <= KINDS[kind].max) {
          const i = nearestIndex(browse, v);
          list = browse.slice(Math.max(0, i - 3), i + 4);
          const exact = exactValue(v, kind);
          if (exact && !list.some((x) => x.key === exact.key)) {
            const ownedExact = owned.find((x) => x.key === exact.key);
            custom = ownedExact ?? exact;
          }
        } else list = [];
      }
    } else {
      const d = cur().decade;
      const inRange = (v) => v.value >= 10 ** d * 0.9999 && v.value < 10 ** (d + 1) * 0.9999;
      const pool = new Map([...browse.filter(inRange), ...owned.filter(inRange)].map((v) => [v.key, v]));
      list = [...pool.values()].sort((a, b) => a.value - b.value);
    }
    if (cur().mine) {
      list = q ? list.filter((v) => ownedKeys.has(v.key)) : owned;
      if (custom && !ownedKeys.has(custom.key)) custom = null;
    }
    return { list: list.slice(0, PAGE), more: Math.max(0, list.length - PAGE), custom, q };
  }

  function exactValue(v, kind) {
    // Keep what was typed (up to 6 significant figures) as an exact sig/exp.
    const [mant, e] = Number(v.toPrecision(6)).toExponential().split('e');
    const digits = mant.replace('.', '');
    const n = normalize(Number(digits), Number(e) - (digits.length - 1));
    return makeValue(n.sig, n.exp, kind);
  }

  function codeToValue(code, kind) {
    // "104" → 10 × 10^4 pF (capacitor) or µH (inductor).
    const v = Number(code.slice(0, 2)) * 10 ** Number(code[2]);
    return kind === 'inductor' ? v * 1000 : v;
  }

  function card(v, { custom = false } = {}) {
    const kind = f.kind;
    const tols = ownedTols(inv, kind, v.key);
    const own = tols.length > 0;
    const code = kind === 'resistor' ? '' : markingCode(v.sig, v.exp, kind);
    const r = kind === 'resistor' ? asResistor(v) : null;
    const stripes = r ? `<span class="mini-bands" aria-hidden="true">${r.bands.slice(0, -1).map((id) => `<i style="background:${COLOR[id].hex}"></i>`).join('')}</span>` : '';
    const chips = KINDS[kind].tolChoices.map((t) => {
      const on = tols.includes(t);
      return `<button type="button" class="tol" data-key="${v.key}" data-tol="${t}" aria-pressed="${on}"
        aria-label="${on ? 'Remove' : 'Add'} ${esc(v.label)} ±${t}%">±${t}%</button>`;
    }).join('');
    const qty = tols.map((t) => {
      const item = inv[kind].find((x) => x.v === v.key && x.tol === t);
      return `<label class="qty">±${t}% · how many
        <input type="number" inputmode="numeric" min="1" max="100000" placeholder="plenty" data-key="${v.key}" data-tol="${t}"
          value="${item?.qty ?? ''}" aria-label="How many ${esc(v.label)} ±${t}% you have (leave empty for plenty)"></label>`;
    }).join('');
    return `<div class="part-card${own ? ' is-owned' : ''}${custom ? ' is-custom' : ''}">
      <div class="part-top"><span class="part-v">${esc(v.label)}</span>${stripes}${code ? `<span class="part-code">${code}</span>` : ''}</div>
      ${custom ? '<p class="part-note">Not a standard value. You can still add it.</p>' : ''}
      <div class="tols" role="group" aria-label="Tolerance for ${esc(v.label)}">${chips}</div>
      ${qty}
    </div>`;
  }

  function renderParts() {
    const { list, more, custom, q } = partList();
    let html = '';
    if (custom) html += card(custom, { custom: true });
    html += list.map((v) => card(v)).join('');
    if (!html) {
      html = `<p class="empty">${cur().mine ? `No ${PLURAL[f.kind]} in your list${q ? ' match that search' : ' yet'}. ${q ? '' : 'Turn off "Show only parts I have" to add some.'}`
        : 'Nothing matches. Try digits like 47, or a value with a unit like 4.7k.'}</p>`;
    }
    if (more) html += `<p class="note">${more} more match. Type more digits to narrow it down.</p>`;
    el.grid.innerHTML = html;
    el.decades.classList.toggle('is-off', !!q || !!cur().mine);
    updateCount();
  }

  let searchTimer = 0;
  el.search.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderParts, 120); });
  el.pSeries.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sfx.tap(); cur().browse = b.dataset.series; setRadio(el.pSeries, 'series', cur().browse); persistSettings(); renderParts();
  });
  el.decades.addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    sfx.tap(); cur().decade = Number(b.dataset.decade);
    $$('button', el.decades).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    if (el.search.value) el.search.value = '';
    persistSettings(); renderParts();
  });
  el.mine.addEventListener('change', () => { cur().mine = el.mine.checked; persistSettings(); renderParts(); });

  el.grid.addEventListener('click', (e) => {
    const b = e.target.closest('.tol'); if (!b) return;
    const { key } = b.dataset;
    const tol = Number(b.dataset.tol);
    let added;
    try { added = togglePart(inv, f.kind, key, tol); } catch { el.status.textContent = "That value can't be added."; return; }
    persist();
    sfx.tap();
    const { sig, exp } = splitKey(key);
    const label = makeValue(sig, exp, f.kind).label;
    el.status.textContent = added ? `Added ${label} ±${tol}%.` : `Removed ${label} ±${tol}%.`;
    const scrollY = $('.screens').scrollTop;
    renderParts();
    $('.screens').scrollTop = scrollY;
    const again = el.grid.querySelector(`.tol[data-key="${key}"][data-tol="${tol}"]`);
    again?.focus({ preventScroll: true });
  });
  el.grid.addEventListener('change', (e) => {
    const i = e.target.closest('.qty input'); if (!i) return;
    setQty(inv, f.kind, i.dataset.key, Number(i.dataset.tol), i.value);
    persist();
    el.status.textContent = i.value ? `Saved: you have ${i.value}.` : 'Saved: plenty.';
  });

  el.kits.addEventListener('click', (e) => {
    const b = e.target.closest('[data-kit]'); if (!b) return;
    const kit = KITS[f.kind].find((k) => k.id === b.dataset.kit);
    const n = addKit(inv, f.kind, kit.series, kit.tol, kit.lo, kit.hi);
    persist(); sfx.tap();
    el.status.textContent = n ? `Added ${n} values from the ${kit.label}.` : 'You already have every value in that kit.';
    renderParts();
  });

  $('#parts-export').addEventListener('click', () => {
    const text = exportInventory(inv);
    try {
      const blob = new Blob([text], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `ohm-meter-parts-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      el.status.textContent = 'Exported your parts list as a file.';
    } catch { el.status.textContent = "Couldn't save the file in this browser."; }
    navigator.clipboard?.writeText(text).then(() => { el.status.textContent += ' A copy is also on your clipboard.'; }).catch(() => {});
  });

  function doImport(text) {
    const merge = confirm('Add these parts to your current lists?\n\nOK adds them. Cancel replaces your lists with the imported ones.');
    try {
      const r = importInventory(inv, text, { merge });
      inv = r.inv;
      persist();
      el.status.textContent = `Imported ${r.total} parts (${r.added} new).`;
      renderParts();
    } catch (err) { el.status.textContent = err.message; }
  }
  $('#parts-import').addEventListener('click', () => el.file.click());
  el.file.addEventListener('change', async () => {
    const file = el.file.files?.[0]; if (!file) return;
    if (file.size > 2e6) { el.status.textContent = 'That file is too big to be a parts list.'; return; }
    doImport(await file.text());
    el.file.value = '';
  });
  $('#parts-paste').addEventListener('click', () => {
    const text = prompt('Paste an exported parts list:');
    if (text) doImport(text);
  });
  $('#parts-clear').addEventListener('click', () => {
    if (!inv[f.kind].length) { el.status.textContent = 'This list is already empty.'; return; }
    if (!confirm(`Remove all ${inv[f.kind].length} entries from your ${NOUN[f.kind]} list? Export it first if you want a backup.`)) return;
    inv[f.kind] = [];
    persist();
    el.status.textContent = `Cleared your ${NOUN[f.kind]} list.`;
    renderParts();
  });

  /* =================== first show =================== */
  return function onShow() {
    if (!st.ready) st.ready = true;
    applyKind();
  };
}

/* Tiny schematics. Resistors and inductors draw as IEC boxes; capacitors as plates. */
function schematic(layout, kind) {
  const part = (x, y) => (kind === 'capacitor'
    ? `<path class="cap" d="M${x + 8} ${y - 6}V${y + 6}M${x + 14} ${y - 6}V${y + 6}"/><rect class="gap" x="${x + 9}" y="${y - 1}" width="4" height="2"/>`
    : kind === 'inductor'
      ? `<path class="coil" d="M${x} ${y}c0-6 5.5-6 5.5 0c0-6 5.5-6 5.5 0c0-6 5.5-6 5.5 0c0-6 5.5-6 5.5 0"/><rect class="gap" x="${x}" y="${y + 0.5}" width="22" height="3"/>`
      : `<rect x="${x}" y="${y - 5}" width="22" height="10" rx="1.5"/>`);
  const W = 'class="sch" viewBox="0 0 120 44" width="120" height="44" aria-hidden="true"';
  switch (layout) {
    case 'series2': return `<svg ${W}><path d="M2 22H118"/>${part(26, 22)}${part(72, 22)}</svg>`;
    case 'series3': return `<svg ${W}><path d="M2 22H118"/>${part(12, 22)}${part(49, 22)}${part(86, 22)}</svg>`;
    case 'parallel2': return `<svg ${W}><path d="M2 22H22M98 22H118M22 12V32M98 12V32M22 12H98M22 32H98"/>${part(49, 12)}${part(49, 32)}</svg>`;
    case 'parallel3': return `<svg ${W}><path d="M2 22H22M98 22H118M22 7V37M98 7V37M22 7H98M22 22H98M22 37H98"/>${part(49, 7)}${part(49, 22)}${part(49, 37)}</svg>`;
    case 'seriesParallel': return `<svg ${W}><path d="M2 22H14M106 22H118M14 12V32M106 12V32M14 12H106M14 32H106"/>${part(28, 12)}${part(70, 12)}${part(49, 32)}</svg>`;
    case 'parallelSeries': return `<svg ${W}><path d="M2 22H10M10 12V32M60 12V32M10 12H60M10 32H60M60 22H118"/>${part(24, 12)}${part(24, 32)}${part(80, 22)}</svg>`;
    default: return '';
  }
}
