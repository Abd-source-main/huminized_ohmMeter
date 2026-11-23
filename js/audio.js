// Every sound is synthesized with Web Audio: no files, works offline.
// Each voice ramps in and out exponentially from a near-zero floor, so
// nothing clicks or pops.

let ctx = null;
let master = null;
let enabled = true;
let volume = 0.7;
let noiseBuf = null;

export function configure({ sound, volume: v }) {
  enabled = !!sound;
  volume = v;
  if (master) master.gain.setTargetAtTime(volume * 0.6, ctx.currentTime, 0.02);
}

/** Call from a user gesture. Creates and resumes the context (iOS needs a sound inside the gesture). */
export function unlock() {
  try {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume * 0.6;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      master.connect(comp).connect(ctx.destination);
      const b = ctx.createBuffer(1, 1, ctx.sampleRate);
      const s = ctx.createBufferSource();
      s.buffer = b; s.connect(ctx.destination); s.start(0);
    }
    if (ctx.state === 'suspended') ctx.resume();
  } catch { /* audio unavailable: play silently */ }
}

const ready = () => enabled && ctx && ctx.state === 'running' && volume > 0;

function tone({ freq, to, type = 'sine', at = 0, attack = 0.005, dur = 0.15, gain = 0.4, filter }) {
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  let node = o.connect(g);
  if (filter) {
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = filter; f.Q.value = 0.7;
    node = g.connect(f);
  }
  node.connect(master);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noise({ at = 0, dur = 0.08, gain = 0.2, freq = 900 }) {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.3), ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + at;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass'; f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t);
  s.stop(t + dur + 0.05);
}

export const sfx = {
  land() {
    if (!ready()) return;
    tone({ freq: 150, to: 55, dur: 0.18, gain: 0.55, attack: 0.003 });
    noise({ dur: 0.06, gain: 0.12, freq: 700 });
  },
  tap() {
    if (!ready()) return;
    tone({ freq: 620, to: 520, type: 'triangle', dur: 0.05, gain: 0.18, attack: 0.002 });
  },
  correct() {
    if (!ready()) return;
    tone({ freq: 784, type: 'triangle', dur: 0.16, gain: 0.32 });
    tone({ freq: 1175, type: 'sine', at: 0.08, dur: 0.32, gain: 0.3 });
    tone({ freq: 2350, type: 'sine', at: 0.08, dur: 0.2, gain: 0.05 });
  },
  wrong() {
    if (!ready()) return;
    tone({ freq: 196, to: 130, type: 'sawtooth', dur: 0.32, gain: 0.22, attack: 0.01, filter: 700 });
    tone({ freq: 98, to: 82, type: 'square', dur: 0.3, gain: 0.1, attack: 0.01, filter: 400 });
  },
  streak() {
    if (!ready()) return;
    [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', at: 0.3 + i * 0.07, dur: 0.18, gain: 0.22 }));
  },
  highScore() {
    if (!ready()) return;
    const n = [[523, 0, 0.14], [523, 0.14, 0.1], [659, 0.26, 0.14], [784, 0.42, 0.42]];
    n.forEach(([f, at, d]) => {
      tone({ freq: f, type: 'square', at: 0.35 + at, dur: d, gain: 0.1, filter: 2400 });
      tone({ freq: f / 2, type: 'triangle', at: 0.35 + at, dur: d, gain: 0.2 });
    });
  },
  detent() {
    if (!ready()) return;
    noise({ dur: 0.018, gain: 0.07, freq: 2600 });
  },
  tick(urgent = false) {
    if (!ready()) return;
    tone({ freq: urgent ? 1760 : 1320, type: 'sine', dur: 0.04, gain: urgent ? 0.22 : 0.14, attack: 0.002 });
  },
};

export function haptic(kind, on) {
  if (!on || !navigator.vibrate) return;
  try { navigator.vibrate(kind === 'wrong' ? [35, 45, 35] : 18); } catch { /* unsupported */ }
}
