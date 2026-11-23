// Pure resistor logic: no DOM. Imported by the app and by the Node tests.
// Values are stored exactly as an integer significand and a power-of-ten
// exponent (value = sig × 10^exp) so gold/silver math never hits float drift.

export const COLORS = [
  { id: 'black',  name: 'Black',  code: 'BK', hex: '#1b1b1b', digit: 0, exp: 0 },
  { id: 'brown',  name: 'Brown',  code: 'BN', hex: '#6e3b1f', digit: 1, exp: 1, tol: 1 },
  { id: 'red',    name: 'Red',    code: 'RD', hex: '#c8261c', digit: 2, exp: 2, tol: 2 },
  { id: 'orange', name: 'Orange', code: 'OG', hex: '#e8731a', digit: 3, exp: 3 },
  { id: 'yellow', name: 'Yellow', code: 'YE', hex: '#f3c919', digit: 4, exp: 4 },
  { id: 'green',  name: 'Green',  code: 'GN', hex: '#2c8f3b', digit: 5, exp: 5, tol: 0.5 },
  { id: 'blue',   name: 'Blue',   code: 'BU', hex: '#2156c6', digit: 6, exp: 6, tol: 0.25 },
  { id: 'violet', name: 'Violet', code: 'VT', hex: '#7b3db3', digit: 7, exp: 7, tol: 0.1 },
  { id: 'gray',   name: 'Gray',   code: 'GY', hex: '#8b8b8b', digit: 8, exp: 8, tol: 0.05 },
  { id: 'white',  name: 'White',  code: 'WH', hex: '#f1f1ec', digit: 9, exp: 9 },
  { id: 'gold',   name: 'Gold',   code: 'GD', hex: '#c9a13b', exp: -1, tol: 5 },
  { id: 'silver', name: 'Silver', code: 'SR', hex: '#b9bcc0', exp: -2, tol: 10 },
];

export const COLOR = Object.fromEntries(COLORS.map((c) => [c.id, c]));
export const TOLERANCE_IDS = ['brown', 'red', 'green', 'blue', 'violet', 'gray', 'gold', 'silver'];

// Real-world preferred values, so players learn the values they will meet.
export const E24 = [10, 11, 12, 13, 15, 16, 18, 20, 22, 24, 27, 30, 33, 36, 39, 43, 47, 51, 56, 62, 68, 75, 82, 91];
export const E96 = [100, 102, 105, 107, 110, 113, 115, 118, 121, 124, 127, 130, 133, 137, 140, 143, 147, 150, 154,
  158, 162, 165, 169, 174, 178, 182, 187, 191, 196, 200, 205, 210, 215, 221, 226, 232, 237, 243, 249, 255, 261, 267,
  274, 280, 287, 294, 301, 309, 316, 324, 332, 340, 348, 357, 365, 374, 383, 392, 402, 412, 422, 432, 442, 453, 464,
  475, 487, 499, 511, 523, 536, 549, 562, 576, 590, 604, 619, 634, 649, 665, 681, 698, 715, 732, 750, 768, 787, 806,
  825, 845, 866, 887, 909, 931, 953, 976];

const UNITS = [
  { exp: -3, label: 'mΩ' },
  { exp: 0, label: 'Ω' },
  { exp: 3, label: 'kΩ' },
  { exp: 6, label: 'MΩ' },
  { exp: 9, label: 'GΩ' },
];
export const UNIT_FACTORS = { 'mΩ': 1e-3, 'Ω': 1, 'kΩ': 1e3, 'MΩ': 1e6 };

/** Exact decimal string of sig × 10^exp (no float math). */
export function decimalString(sig, exp) {
  let s = String(sig);
  if (exp >= 0) return s + '0'.repeat(exp);
  const k = -exp;
  if (s.length <= k) s = '0'.repeat(k - s.length + 1) + s;
  let out = s.slice(0, s.length - k) + '.' + s.slice(s.length - k);
  out = out.replace(/0+$/, '').replace(/\.$/, '');
  return out;
}

function groupThousands(str) {
  const [i, f] = str.split('.');
  const g = i.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return f ? `${g}.${f}` : g;
}

/** Remove trailing zeros from sig, folding them into exp. */
export function normalize(sig, exp) {
  if (sig === 0) return { sig: 0, exp: 0 };
  while (sig % 10 === 0) { sig /= 10; exp += 1; }
  return { sig, exp };
}

export const keyOf = (sig, exp) => { const n = normalize(sig, exp); return `${n.sig}e${n.exp}`; };
export const toOhms = (sig, exp) => Number(`${sig}e${exp}`);

/** Power of ten of the leading digit. */
const magnitude = (sig, exp) => String(sig).length - 1 + exp;

/** Format with the right unit: 0.47 → "470 mΩ", 1000 → "1 kΩ", 4700000 → "4.7 MΩ". */
export function formatValue(sig, exp) {
  const mag = magnitude(sig, exp);
  let unit = UNITS[0];
  for (const u of UNITS) if (mag >= u.exp) unit = u;
  return `${decimalString(sig, exp - unit.exp)} ${unit.label}`;
}

/** Plain ohms with thousands separators, e.g. "4,700,000 Ω". */
export const formatOhms = (sig, exp) => `${groupThousands(decimalString(sig, exp))} Ω`;

export const multiplierLabel = (exp) => `×${groupThousands(decimalString(1, exp))}`;
export const toleranceLabel = (tol) => `±${tol}%`;

/** Which difficulty range a value belongs to. */
export function rangeOf(sig, exp) {
  if (exp < 0) return 'milli';            // gold / silver multiplier
  const mag = magnitude(sig, exp);
  if (mag < 3) return 'ohm';
  if (mag < 6) return 'kilo';
  if (mag < 8) return 'mega';             // up to tens of MΩ
  return null;
}

/** Build a resistor from its significand, multiplier exponent and tolerance color. */
export function makeResistor(sig, exp, tolId, bandCount) {
  const digitCount = bandCount === 5 ? 3 : 2;
  const s = String(sig);
  if (s.length !== digitCount) throw new Error(`sig ${sig} needs ${digitCount} digits`);
  const digitIds = [...s].map((d) => COLORS[Number(d)].id);
  const mult = COLORS.find((c) => c.exp === exp);
  if (!mult) throw new Error(`no multiplier color for 10^${exp}`);
  const tol = COLOR[tolId];
  if (tol?.tol == null) throw new Error(`${tolId} is not a tolerance color`);
  return {
    bandCount,
    sig,
    exp,
    bands: [...digitIds, mult.id, tolId],
    tolerance: tol.tol,
    ohms: toOhms(sig, exp),
    label: formatValue(sig, exp),
    key: keyOf(sig, exp),
  };
}

/** Decode a band list back into a resistor (the inverse of makeResistor). */
export function decodeBands(bands) {
  const bandCount = bands.length;
  if (bandCount !== 4 && bandCount !== 5) throw new Error('need 4 or 5 bands');
  const digits = bands.slice(0, bandCount - 2).map((id) => COLOR[id].digit);
  if (digits.some((d) => d == null)) throw new Error('gold/silver cannot be a digit');
  const sig = Number(digits.join(''));
  const exp = COLOR[bands[bandCount - 2]].exp;
  return makeResistor(sig, exp, bands[bandCount - 1], bandCount);
}

/** Per-band explanation plus the formula line. */
export function breakdown(r) {
  const n = r.bandCount - 2;
  const items = r.bands.map((id, i) => {
    const c = COLOR[id];
    if (i < n) return { id, name: c.name, role: `Digit ${i + 1}`, text: String(c.digit) };
    if (i === n) return { id, name: c.name, role: 'Multiplier', text: multiplierLabel(c.exp) };
    return { id, name: c.name, role: 'Tolerance', text: toleranceLabel(c.tol) };
  });
  const ohms = formatOhms(r.sig, r.exp);
  const pretty = r.label;
  const value = ohms.replace(/,/g, '') === pretty ? ohms : `${ohms} = ${pretty}`;
  const parts = items.slice(0, n + 1).map((b) => `${b.name} = ${b.text}`).join(', ');
  const summary = `${parts} → ${value}, ${items[n + 1].name} = ${items[n + 1].text}`;
  return { items, formula: `${r.sig} ${multiplierLabel(r.exp)} = ${ohms}`, value, summary };
}

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const DEFAULT_SETTINGS = {
  bands: '4',            // '4' | '5' | 'mixed'
  milli: false,
  kilo: true,
  mega: false,
  tolerances: [...TOLERANCE_IDS],
};

/** Random resistor for the current difficulty settings. */
export function generateResistor(settings = DEFAULT_SETTINGS, rng = Math.random) {
  const bandCount = settings.bands === 'mixed' ? (rng() < 0.5 ? 4 : 5) : Number(settings.bands);
  const ranges = ['ohm'];
  if (settings.milli) ranges.push('milli');
  if (settings.kilo) ranges.push('kilo');
  if (settings.mega) ranges.push('mega');
  const range = pick(ranges, rng);

  let sig;
  if (bandCount === 4) sig = pick(E24, rng);
  else sig = rng() < 0.5 ? pick(E96, rng) : pick(E24, rng) * 10;

  const exps = [];
  for (let e = -2; e <= 9; e++) if (rangeOf(sig, e) === range) exps.push(e);
  const exp = pick(exps, rng);

  const tols = settings.tolerances?.length ? settings.tolerances : TOLERANCE_IDS;
  return makeResistor(sig, exp, pick(tols, rng), bandCount);
}

const validValue = (sig, exp) => sig > 0 && Number.isInteger(sig) && exp >= -3 && magnitude(sig, exp) < 9;

/**
 * Four unique answer choices, exactly one correct. Distractors model real
 * misreads: wrong multiplier, swapped digits, a neighbouring color, or
 * reading the multiplier band as another digit.
 */
export function makeOptions(r, rng = Math.random, count = 4) {
  const { sig, exp } = r;
  const s = String(sig);
  const cands = [];
  const add = (a, b) => { if (validValue(a, b)) cands.push({ sig: a, exp: b }); };

  add(sig, exp + 1); add(sig, exp - 1); add(sig, exp + 2); add(sig, exp - 3);
  if (s[0] !== s[1] && s[1] !== '0') add(Number(s[1] + s[0] + s.slice(2)), exp);
  const rev = [...s].reverse().join('');
  if (rev[0] !== '0') add(Number(rev), exp);
  for (let i = 0; i < s.length; i++) {
    for (const d of [-1, 1]) {
      const nd = Number(s[i]) + d;
      if (nd < 0 || nd > 9 || (i === 0 && nd === 0)) continue;
      add(Number(s.slice(0, i) + nd + s.slice(i + 1)), exp);
    }
  }
  if (exp >= 0 && exp <= 9) add(sig * 10 + exp, 0);   // multiplier read as a digit

  const seen = new Set([r.key]);
  const out = [{ sig, exp, label: r.label, key: r.key, correct: true }];
  for (const c of shuffle(cands, rng)) {
    if (out.length >= count) break;
    const key = keyOf(c.sig, c.exp);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...c, label: formatValue(c.sig, c.exp), key, correct: false });
  }
  let guard = 0;
  while (out.length < count && guard++ < 200) {
    const g = generateResistor({ ...DEFAULT_SETTINGS, bands: String(r.bandCount), kilo: true, mega: true }, rng);
    if (seen.has(g.key)) continue;
    seen.add(g.key);
    out.push({ sig: g.sig, exp: g.exp, label: g.label, key: g.key, correct: false });
  }
  return shuffle(out, rng);
}

/**
 * Parse a typed answer into ohms. Accepts "4.7" with the chosen unit,
 * "4.7k", "4,7", and RKM codes such as "4k7", "R47", "2M2", "470m".
 */
export function parseAnswer(text, unit = 'Ω') {
  const t = String(text).trim().replace(/\s+/g, '').replace(/(Ω|ohms?)$/i, '').replace(',', '.');
  if (!t) return NaN;
  const prefix = { r: 1, R: 1, k: 1e3, K: 1e3, M: 1e6, m: 1e-3 };
  let m = t.match(/^(\d*)([rRkKmM])(\d+)$/);            // RKM: 4k7, R47, 2M2
  if (m && (m[1] || m[2] === 'r' || m[2] === 'R')) {
    return Number(`${m[1] || '0'}.${m[3]}`) * prefix[m[2]];
  }
  m = t.match(/^(\d+(?:\.\d*)?|\.\d+)([rRkKmM])?$/);
  if (!m) return NaN;
  const n = Number(m[1]);
  return m[2] ? n * prefix[m[2]] : n * (UNIT_FACTORS[unit] ?? 1);
}

export const sameValue = (ohms, r) => Number.isFinite(ohms) && Math.abs(ohms - r.ohms) <= Math.abs(r.ohms) * 1e-9;

/** Points for a correct answer. */
export function pointsFor({ streak, bandCount, timeFraction = 0 }) {
  const base = bandCount === 5 ? 150 : 100;
  const streakBonus = Math.min(Math.max(streak - 1, 0), 10) * 20;
  return base + streakBonus + Math.round(50 * timeFraction);
}
export const PENALTY = 50;
