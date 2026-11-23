import {
  COLORS, COLOR, TOLERANCE_IDS, DEFAULT_SETTINGS, generateResistor, makeOptions, breakdown,
  parseAnswer, sameValue, pointsFor, PENALTY, multiplierLabel, toleranceLabel,
} from './core.js';
import { resistorSVG, DEFS } from './render.js';
import { sfx, unlock, configure as configureAudio, haptic } from './audio.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/* ---------- storage (every access guarded: private mode can throw) ---------- */
const store = {
  get(k, fallback) {
    try { const v = localStorage.getItem(k); return v ? { ...fallback, ...JSON.parse(v) } : { ...fallback }; }
    catch { return { ...fallback }; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
const K = { settings: 'hom.settings.v1', stats: 'hom.stats.v1', game: 'hom.game.v1' };

const settings = store.get(K.settings, {
  ...DEFAULT_SETTINGS,
  timer: false, timerSecs: 15, answerMode: 'choice',
  sound: true, volume: 0.7, haptics: true, codes: false,
});
const stats = store.get(K.stats, { played: 0, correct: 0, bestStreak: 0, best: 0 });
const game = store.get(K.game, { score: 0, streak: 0 });

const state = {
  r: null, options: [], answered: false, unit: 'Ω',
  startBest: stats.best, celebrated: false, dirty: false,
  timer: { raf: 0, start: 0, duration: 0, remaining: 0, lastTick: null, running: false },
};

/* ---------- elements ---------- */
const el = {
  score: $('#score'), streak: $('#streak'), best: $('#best'),
  holder: $('#rz-holder'), drop: $('#rz-drop'), react: $('#rz-react'), shadow: $('#rz-shadow'),
  stage: $('#stage'), verdict: $('#verdict'), points: $('#points'), live: $('#live'),
  ask: $('#ask'), choices: $('#choices'), typed: $('#typed'), input: $('#typed-input'), err: $('#typed-err'),
  reveal: $('#reveal'), revealVerdict: $('#reveal-verdict'), revealValue: $('#reveal-value'),
  bands: $('#bands'), formula: $('#formula'), next: $('#next'),
  timer: $('#timer'), timerFill: $('#timer-fill'),
};

document.body.insertAdjacentHTML('afterbegin', DEFS);

/* ---------- helpers ---------- */
function restartAnim(node, cls) {
  node.classList.remove(cls);
  void node.offsetWidth;            // force reflow so the animation replays
  node.classList.add(cls);
}
function swatch(id) {
  if (id === 'gold') return 'linear-gradient(180deg,#6e5212,#f6e08f 35%,#c9a13b 60%,#5f460f)';
  if (id === 'silver') return 'linear-gradient(180deg,#5b5f63,#f5f7f9 35%,#b6b9bd 60%,#4b4f52)';
  return COLOR[id].hex;
}
function renderHud(bump) {
  el.score.textContent = game.score;
  el.streak.textContent = game.streak;
  el.best.textContent = stats.best;
  el.streak.classList.toggle('hot', game.streak >= 5);
  if (bump) restartAnim(el.score, 'bump');
}
const save = () => { store.set(K.game, game); store.set(K.stats, stats); };

/* ---------- rounds ---------- */
function drawResistor(reveal = false) {
  el.holder.innerHTML = resistorSVG(state.r, { reveal, codes: settings.codes });
}

function newRound() {
  state.r = generateResistor(settings);
  state.options = makeOptions(state.r);
  state.answered = false;
  state.dirty = false;
  drawResistor(false);

  el.stage.classList.remove('ok', 'bad');
  el.verdict.className = 'verdict';
  el.points.className = 'points';
  el.react.className = 'rz-react';
  el.drop.classList.remove('leave');
  restartAnim(el.drop, 'enter');
  restartAnim(el.shadow, 'enter');
  setTimeout(() => sfx.land(), reducedMotion.matches ? 0 : 370);

  el.reveal.hidden = true;
  el.ask.hidden = false;
  el.err.textContent = '';
  el.input.value = '';
  renderChoices();
  applyAnswerMode();
  startTimer();
}

function nextRound() {
  if (reducedMotion.matches) return newRound();
  el.drop.classList.remove('enter');
  el.drop.classList.add('leave');
  setTimeout(newRound, 240);
}

function renderChoices() {
  el.choices.innerHTML = state.options.map((o, i) =>
    `<button type="button" class="choice" data-i="${i}" aria-keyshortcuts="${i + 1}">${o.label}</button>`).join('');
}

function applyAnswerMode() {
  const typed = settings.answerMode === 'type';
  el.choices.hidden = typed;
  el.typed.hidden = !typed;
  $$('#ask .seg button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === settings.answerMode)));
}

function answer(correct, given) {
  if (state.answered) return;
  state.answered = true;
  const frac = stopTimer();
  const r = state.r;

  stats.played += 1;
  let delta;
  if (correct) {
    game.streak += 1;
    delta = pointsFor({ streak: game.streak, bandCount: r.bandCount, timeFraction: settings.timer ? frac : 0 });
    game.score += delta;
    stats.correct += 1;
    stats.bestStreak = Math.max(stats.bestStreak, game.streak);
  } else {
    delta = -Math.min(PENALTY, game.score);
    game.score += delta;
    game.streak = 0;
  }
  let newBest = false;
  if (game.score > stats.best) {
    stats.best = game.score;
    if (state.startBest > 0 && !state.celebrated) { state.celebrated = true; newBest = true; }
  }
  save();
  renderHud(correct);

  // Feedback on the stage
  el.stage.classList.add(correct ? 'ok' : 'bad');
  el.verdict.textContent = correct ? 'OK' : (given === null ? "Time's up" : 'Not quite');
  el.verdict.className = `verdict show ${correct ? 'ok' : 'bad'}`;
  const pts = delta === 0 ? '' : `${delta > 0 ? '+' : ''}${delta}`;
  el.points.textContent = newBest ? `${pts} · New best` : pts;
  restartAnim(el.points, 'show');
  el.points.classList.add(correct ? 'ok' : 'bad');
  restartAnim(el.react, correct ? 'pop' : 'shake');

  if (correct) {
    sfx.correct();
    if (game.streak > 0 && game.streak % 5 === 0) sfx.streak();
  } else sfx.wrong();
  if (newBest) setTimeout(() => sfx.highScore(), game.streak % 5 === 0 ? 350 : 0);
  haptic(correct ? 'ok' : 'wrong', settings.haptics);

  drawResistor(true);
  showReveal(correct, given);
}

function showReveal(correct, given) {
  const r = state.r;
  const b = breakdown(r);
  const n = r.bandCount - 2;
  el.revealVerdict.textContent = correct
    ? (game.streak >= 2 ? `Correct, streak ${game.streak}` : 'Correct')
    : given === null ? "Time's up" : `You said ${given}`;
  el.revealVerdict.className = `reveal-verdict ${correct ? 'ok' : 'bad'}`;
  el.revealValue.innerHTML = `${r.label}<small>±${r.tolerance}%</small>`;
  el.bands.innerHTML = b.items.map((it) =>
    `<li><span class="sw" style="background:${swatch(it.id)}"></span>` +
    `<span class="nm">${it.name}<span class="rl">${it.role}</span></span><span class="vl">${it.text}</span></li>`).join('');
  const digits = b.items.slice(0, n).map((it) => it.text).join('');
  el.formula.innerHTML = `${digits} ${multiplierLabel(r.exp)} → <b>${b.value}</b>`;

  el.ask.hidden = true;
  el.reveal.hidden = false;
  restartAnim(el.reveal, 'enter');
  el.live.textContent = `${correct ? 'Correct.' : 'Not quite.'} ${b.summary}`;
  el.next.focus({ preventScroll: true });
}

/* ---------- timer ---------- */
function startTimer() {
  cancelAnimationFrame(state.timer.raf);
  el.timer.hidden = !settings.timer;
  if (!settings.timer) return;
  state.timer.duration = settings.timerSecs * 1000;
  state.timer.remaining = state.timer.duration;
  state.timer.lastTick = null;
  resumeTimer();
}
function resumeTimer() {
  if (!settings.timer || state.answered || state.timer.running) return;
  state.timer.running = true;
  state.timer.start = performance.now() - (state.timer.duration - state.timer.remaining);
  const loop = (now) => {
    const left = Math.max(0, state.timer.duration - (now - state.timer.start));
    state.timer.remaining = left;
    const frac = left / state.timer.duration;
    el.timerFill.style.transform = `scaleX(${frac})`;
    const secs = Math.ceil(left / 1000);
    el.timerFill.classList.toggle('low', secs <= 5);
    if (secs <= 5 && secs > 0 && secs !== state.timer.lastTick) {
      state.timer.lastTick = secs;
      sfx.tick(secs <= 2);
    }
    if (left <= 0) { state.timer.running = false; answer(false, null); return; }
    state.timer.raf = requestAnimationFrame(loop);
  };
  state.timer.raf = requestAnimationFrame(loop);
}
function pauseTimer() {
  cancelAnimationFrame(state.timer.raf);
  state.timer.running = false;
}
function stopTimer() {
  pauseTimer();
  return settings.timer ? state.timer.remaining / state.timer.duration : 0;
}

/* ---------- events: play ---------- */
el.choices.addEventListener('click', (e) => {
  const btn = e.target.closest('.choice');
  if (!btn || state.answered) return;
  sfx.tap();
  const o = state.options[Number(btn.dataset.i)];
  $$('.choice', el.choices).forEach((b, i) => {
    b.disabled = true;
    if (state.options[i].correct) b.classList.add('is-correct');
  });
  if (!o.correct) btn.classList.add('is-wrong');
  answer(o.correct, o.label);
});

el.typed.addEventListener('submit', (e) => {
  e.preventDefault();
  if (state.answered) return;
  const raw = el.input.value;
  const ohms = parseAnswer(raw, state.unit);
  if (!Number.isFinite(ohms)) {
    el.err.textContent = 'Enter a number, such as 4.7, then pick a unit. Codes like 4k7 also work.';
    return;
  }
  el.err.textContent = '';
  sfx.tap();
  el.input.blur();
  const shown = /[a-zA-ZΩ]/.test(raw) ? raw.trim() : `${raw.trim()} ${state.unit}`;
  answer(sameValue(ohms, state.r), shown);
});

$$('.units button').forEach((b) => b.addEventListener('click', () => {
  state.unit = b.dataset.unit;
  $$('.units button').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
  sfx.tap();
}));

$$('#ask .seg button').forEach((b) => b.addEventListener('click', () => {
  settings.answerMode = b.dataset.mode;
  store.set(K.settings, settings);
  applyAnswerMode();
  sfx.tap();
}));

el.next.addEventListener('click', () => { sfx.tap(); nextRound(); });

$('#restart').addEventListener('click', () => {
  if (game.score > 0 && !confirm('Start a new game? Your current score resets to 0. Your best score is kept.')) return;
  game.score = 0; game.streak = 0;
  state.startBest = stats.best; state.celebrated = false;
  save(); renderHud(); newRound();
});

document.addEventListener('keydown', (e) => {
  if (currentScreen !== 'play' || e.target.matches('input, select, textarea')) return;
  if (!state.answered && settings.answerMode === 'choice' && /^[1-4]$/.test(e.key)) {
    $$('.choice', el.choices)[Number(e.key) - 1]?.click();
  }
});

/* ---------- screens ---------- */
let currentScreen = 'play';
function showScreen(name) {
  currentScreen = name;
  $$('.screen').forEach((s) => {
    const on = s.id === `screen-${name}`;
    s.hidden = !on;
    s.classList.toggle('is-active', on);
  });
  $$('.tab').forEach((t) => {
    if (t.dataset.screen === name) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  $('.screens').scrollTop = 0;
  if (name === 'play') {
    if (state.dirty && !state.answered) newRound();
    else resumeTimer();
  } else pauseTimer();
  if (name === 'settings') renderStats();
}
$$('.tab').forEach((t) => t.addEventListener('click', () => { sfx.tap(); showScreen(t.dataset.screen); }));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) pauseTimer(); else if (currentScreen === 'play') resumeTimer();
});

/* ---------- chart ---------- */
const compactMult = (e) => (e < 0 ? multiplierLabel(e) : `×${['1', '10', '100', '1k', '10k', '100k', '1M', '10M', '100M', '1G'][e]}`);
$('#chart-body').innerHTML = COLORS.map((c) => `<tr>
  <th scope="row"><span class="sw" style="background:${swatch(c.id)}"></span>${c.name}</th>
  <td>${c.digit ?? '<span class="na" aria-label="none">–</span>'}</td>
  <td>${compactMult(c.exp)}</td>
  <td>${c.tol != null ? toleranceLabel(c.tol) : '<span class="na" aria-label="none">–</span>'}</td>
</tr>`).join('');

/* ---------- settings ---------- */
const form = $('#settings');
$('#tol-chips').innerHTML = TOLERANCE_IDS.map((id) =>
  `<label class="chip"><input type="checkbox" name="tol" value="${id}"><span class="sw" style="background:${swatch(id)}"></span>` +
  `${COLOR[id].name} <span class="tol">${toleranceLabel(COLOR[id].tol)}</span></label>`).join('');

function fillForm() {
  for (const name of ['milli', 'kilo', 'mega', 'timer', 'sound', 'haptics', 'codes']) form.elements[name].checked = !!settings[name];
  form.elements.timerSecs.value = String(settings.timerSecs);
  form.elements.volume.value = String(settings.volume);
  $$('input[name="tol"]', form).forEach((i) => { i.checked = settings.tolerances.includes(i.value); });
  $$('[data-setting="bands"] button', form).forEach((b) => b.setAttribute('aria-checked', String(b.dataset.value === settings.bands)));
}

form.addEventListener('change', (e) => {
  const t = e.target;
  const difficulty = ['milli', 'kilo', 'mega', 'tol', 'timer', 'timerSecs'];
  if (t.name === 'tol') {
    const picked = $$('input[name="tol"]:checked', form).map((i) => i.value);
    if (!picked.length) { t.checked = true; return; }
    settings.tolerances = picked;
  } else if (t.type === 'checkbox') settings[t.name] = t.checked;
  else if (t.name === 'timerSecs') settings.timerSecs = Number(t.value);
  else if (t.name === 'volume') settings.volume = Number(t.value);
  if (difficulty.includes(t.name)) state.dirty = true;
  if (t.name === 'codes' && state.r) drawResistor(state.answered);
  store.set(K.settings, settings);
  configureAudio(settings);
  if (t.name === 'sound' && t.checked) sfx.tap();
});
form.elements.volume.addEventListener('input', (e) => { settings.volume = Number(e.target.value); configureAudio(settings); });
form.elements.volume.addEventListener('change', () => sfx.correct());
form.addEventListener('submit', (e) => e.preventDefault());

$$('[data-setting="bands"] button', form).forEach((b) => b.addEventListener('click', () => {
  settings.bands = b.dataset.value;
  state.dirty = true;
  store.set(K.settings, settings);
  fillForm();
  sfx.tap();
}));

function renderStats() {
  const acc = stats.played ? Math.round((stats.correct / stats.played) * 1000) / 10 : 0;
  $('#stats').innerHTML = [
    ['High score', stats.best], ['Best streak', stats.bestStreak],
    ['Answered', stats.played], ['Accuracy', stats.played ? `${acc}%` : '–'],
  ].map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join('');
}
$('#reset-stats').addEventListener('click', () => {
  if (!confirm('Reset your high score and all stats? This cannot be undone.')) return;
  Object.assign(stats, { played: 0, correct: 0, bestStreak: 0, best: game.score });
  state.startBest = stats.best;
  save(); renderStats(); renderHud();
});

/* ---------- audio unlock on first gesture ---------- */
const onGesture = () => unlock();
document.addEventListener('pointerdown', onGesture, { passive: true });
document.addEventListener('keydown', onGesture);
configureAudio(settings);

/* ---------- service worker with a clean update flow ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const toast = $('#toast');
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
  const offer = (worker) => {
    toast.hidden = false;
    $('#toast-reload').onclick = () => worker.postMessage({ type: 'SKIP_WAITING' });
  };
  navigator.serviceWorker.register('./sw.js').then((reg) => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => { /* offline-first is best effort */ });
}

/* ---------- start ---------- */
fillForm();
renderHud();
newRound();
