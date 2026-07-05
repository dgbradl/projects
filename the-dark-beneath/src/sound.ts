// Procedural WebAudio sound. No samples — every effect is synthesized.
// Standalone module: imports nothing from the game.

export type Sfx =
  | 'click' | 'dice' | 'hit' | 'crit' | 'miss' | 'monhit' | 'die' | 'down'
  | 'bell' | 'spell' | 'fizzle' | 'heal' | 'loot' | 'door' | 'step'
  | 'torch' | 'levelup' | 'drum' | 'whoosh';

export type Ambience = 'fire' | 'deep' | 'surface' | 'off';

const CFG_KEY = 'dark-beneath-audio';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;

let cfg = { vol: 0.7, muted: false };
try {
  const raw = localStorage.getItem(CFG_KEY);
  if (raw) cfg = { ...cfg, ...JSON.parse(raw) };
} catch { /* defaults */ }

let ambKind: Ambience = 'off';
let ambNodes: { stop?: () => void }[] = [];
let ambTimers: number[] = [];

function persist() {
  try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch { /* ok */ }
}

export function audioConfig() { return { ...cfg }; }

export function setVolume(v: number) {
  cfg.vol = Math.max(0, Math.min(1, v));
  persist();
  if (ctx && master) master.gain.setTargetAtTime(cfg.muted ? 0 : cfg.vol, ctx.currentTime, 0.03);
}

export function setMuted(m: boolean) {
  cfg.muted = m;
  persist();
  if (ctx && master) master.gain.setTargetAtTime(m ? 0 : cfg.vol, ctx.currentTime, 0.03);
}

/** Must be called from a user gesture (click) before any sound will play. */
export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') void ctx.resume(); return; }
  try {
    ctx = new AudioContext();
  } catch { return; }
  master = ctx.createGain();
  master.gain.value = cfg.muted ? 0 : cfg.vol;
  master.connect(ctx.destination);
  // 2s of white noise, reused by everything noisy
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  setAmbience(ambKind, true);
}

// ---------------------------------------------------------------- synth helpers

function tone(type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak: number, dest?: AudioNode) {
  if (!ctx || !master) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(1, f0), t0);
  if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(dest ?? master);
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

function hiss(t0: number, dur: number, peak: number, type: BiquadFilterType, f0: number, f1?: number, Q = 1) {
  if (!ctx || !master || !noiseBuf) return;
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  s.loop = true;
  s.playbackRate.value = 0.8 + Math.random() * 0.4;
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.Q.value = Q;
  flt.frequency.setValueAtTime(Math.max(20, f0), t0);
  if (f1 !== undefined) flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  s.connect(flt).connect(g).connect(master);
  s.start(t0);
  s.stop(t0 + dur + 0.05);
}

// ---------------------------------------------------------------- effects

export function sfx(name: Sfx) {
  if (!ctx || !master) return;
  const t = ctx.currentTime;
  switch (name) {
    case 'click':
      tone('triangle', 1500, 1100, t, 0.03, 0.04);
      break;
    case 'dice': {
      // a rattle of little clicks settling
      for (let i = 0; i < 5; i++) {
        const tt = t + i * 0.035 + Math.random() * 0.015;
        hiss(tt, 0.02, 0.10 * (1 - i * 0.12), 'highpass', 2200 + Math.random() * 1500);
      }
      hiss(t + 0.2, 0.03, 0.08, 'bandpass', 1200, undefined, 4);
      break;
    }
    case 'hit':
      hiss(t, 0.09, 0.22, 'lowpass', 900);
      tone('sine', 170, 85, t, 0.13, 0.3);
      break;
    case 'crit':
      hiss(t, 0.14, 0.3, 'lowpass', 1100);
      tone('sine', 200, 70, t, 0.2, 0.38);
      tone('sawtooth', 240, 80, t + 0.02, 0.22, 0.14);
      break;
    case 'miss':
      hiss(t, 0.16, 0.1, 'bandpass', 500, 2000, 2);
      break;
    case 'monhit':
      hiss(t, 0.1, 0.24, 'lowpass', 500);
      tone('sine', 110, 55, t, 0.16, 0.34);
      break;
    case 'die':
      tone('sawtooth', 170, 45, t, 0.35, 0.16);
      hiss(t + 0.05, 0.25, 0.1, 'lowpass', 600, 200);
      break;
    case 'down':
      tone('sine', 95, 32, t, 0.8, 0.3);
      tone('sine', 48, 30, t + 0.05, 0.6, 0.2);
      break;
    case 'bell': {
      // a mourning bell
      tone('sine', 196, 196, t, 2.4, 0.25);
      tone('sine', 392 * 1.01, 392, t, 1.6, 0.1);
      tone('sine', 587, 585, t, 0.9, 0.05);
      break;
    }
    case 'spell': {
      const base = [523, 659, 880];
      base.forEach((f, i) => tone('triangle', f * (1 + Math.random() * 0.01), f, t + i * 0.07, 0.3, 0.1));
      hiss(t, 0.35, 0.035, 'highpass', 5500);
      break;
    }
    case 'fizzle':
      tone('triangle', 420, 130, t, 0.3, 0.1);
      hiss(t + 0.05, 0.2, 0.07, 'lowpass', 700, 250);
      break;
    case 'heal':
      tone('sine', 392, 392, t, 0.35, 0.1);
      tone('sine', 494, 494, t + 0.12, 0.4, 0.1);
      break;
    case 'loot': {
      const plinks = [1319, 1568, 2093];
      plinks.forEach((f, i) => tone('triangle', f, f * 0.99, t + i * 0.055, 0.16, 0.09));
      break;
    }
    case 'door':
      tone('sawtooth', 55, 95, t, 0.35, 0.09);
      tone('sawtooth', 82, 62, t + 0.15, 0.25, 0.07);
      hiss(t, 0.3, 0.05, 'lowpass', 350);
      break;
    case 'step':
      hiss(t, 0.03, 0.04, 'lowpass', 320);
      break;
    case 'torch':
      hiss(t, 0.3, 0.14, 'bandpass', 1400, 500, 1.5);
      for (let i = 0; i < 3; i++) hiss(t + 0.08 + i * 0.07, 0.02, 0.08, 'highpass', 2500);
      break;
    case 'levelup': {
      [392, 523, 659, 784].forEach((f, i) => tone('triangle', f, f, t + i * 0.09, 0.32, 0.12));
      break;
    }
    case 'drum':
      tone('sine', 75, 38, t, 0.3, 0.45);
      hiss(t, 0.18, 0.22, 'lowpass', 220);
      break;
    case 'whoosh':
      hiss(t, 0.22, 0.1, 'bandpass', 700, 2600, 1.5);
      break;
  }
}

// ---------------------------------------------------------------- ambience

function stopAmbience() {
  for (const n of ambNodes) { try { n.stop?.(); } catch { /* ok */ } }
  ambNodes = [];
  for (const id of ambTimers) window.clearInterval(id);
  ambTimers = [];
}

export function setAmbience(kind: Ambience, force = false) {
  if (!force && kind === ambKind) return;
  ambKind = kind;
  if (!ctx || !master || !noiseBuf) return;
  stopAmbience();
  if (kind === 'off') return;

  const windLevel = kind === 'fire' ? 0.045 : kind === 'deep' ? 0.05 : 0.025;

  // wind: looping filtered noise with a slow swell
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.loop = true;
  const flt = ctx.createBiquadFilter();
  flt.type = 'lowpass';
  flt.frequency.value = kind === 'deep' ? 180 : 260;
  const g = ctx.createGain();
  g.gain.value = windLevel;
  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.08;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = windLevel * 0.5;
  lfo.connect(lfoGain).connect(g.gain);
  src.connect(flt).connect(g).connect(master);
  src.start();
  lfo.start();
  ambNodes.push({ stop: () => { src.stop(); lfo.stop(); g.disconnect(); } });

  if (kind === 'fire') {
    // irregular crackle pops
    ambTimers.push(window.setInterval(() => {
      if (!ctx) return;
      if (Math.random() < 0.5) {
        const t = ctx.currentTime;
        hiss(t, 0.015 + Math.random() * 0.02, 0.04 + Math.random() * 0.05, 'highpass', 1800 + Math.random() * 2500);
      }
    }, 90));
    // low fire rumble
    const rsrc = ctx.createBufferSource();
    rsrc.buffer = noiseBuf;
    rsrc.loop = true;
    rsrc.playbackRate.value = 0.5;
    const rflt = ctx.createBiquadFilter();
    rflt.type = 'lowpass';
    rflt.frequency.value = 120;
    const rg = ctx.createGain();
    rg.gain.value = 0.05;
    rsrc.connect(rflt).connect(rg).connect(master);
    rsrc.start();
    ambNodes.push({ stop: () => { rsrc.stop(); rg.disconnect(); } });
  }

  if (kind === 'deep') {
    // distant drips echoing in the dark
    ambTimers.push(window.setInterval(() => {
      if (!ctx) return;
      if (Math.random() < 0.3) {
        const t = ctx.currentTime + Math.random() * 0.5;
        const f = 700 + Math.random() * 500;
        tone('sine', f, f * 0.55, t, 0.12, 0.05);
        tone('sine', f * 0.98, f * 0.5, t + 0.18, 0.1, 0.02); // faint echo
      }
    }, 1600));
  }
}
