// Procedural sound effects via WebAudio — no assets, tiny footprint.
// The context is created lazily on first play (requires a user gesture).

let ctx = null;
let muted = false;

export function setMuted(m) {
  muted = m;
  if (musicGain) musicGain.gain.setTargetAtTime(m ? 0 : 1, ctx?.currentTime ?? 0, 0.3);
}
export function isMuted() { return muted; }

function ac() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur = 0.12, type = 'sine', gain = 0.07, delay = 0, slideTo = 0) {
  if (muted) return;
  try {
    const c = ac();
    const o = c.createOscillator();
    const g = c.createGain();
    const t = c.currentTime + delay;
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  } catch { /* audio is never worth crashing over */ }
}

export const sfx = {
  goal() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.16, 'triangle', 0.08, i * 0.09)); },
  win() { [392, 523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.22, 'triangle', 0.08, i * 0.11)); },
  lose() { [392, 311, 233, 155].forEach((f, i) => tone(f, 0.3, 'sawtooth', 0.05, i * 0.18)); },
  dealYes() { tone(520, 0.1, 'triangle', 0.07); tone(780, 0.14, 'triangle', 0.07, 0.09); },
  dealNo() { tone(300, 0.12, 'triangle', 0.06); tone(220, 0.16, 'triangle', 0.06, 0.1); },
  hire() { tone(440, 0.07, 'sine', 0.06); tone(660, 0.09, 'sine', 0.06, 0.06); },
  event() { tone(880, 0.09, 'square', 0.04); tone(880, 0.09, 'square', 0.04, 0.16); },
  delivery() { tone(160, 0.14, 'sine', 0.1, 0, 70); },
  cash() { tone(1245, 0.05, 'square', 0.025); tone(1568, 0.08, 'square', 0.025, 0.05); },
  alert() { tone(660, 0.1, 'square', 0.045, 0, 520); },
};

// ---- ambient music bed ----------------------------------------------------
// A slow procedural pad: two-bar chords from a warm progression, detuned
// triangles through a lowpass, whisper-quiet. No assets, no loops to ship.

let musicOn = false;
let musicGain = null;
let musicTimer = null;
let chordNodes = [];
let chordIx = 0;

// C major-ish progression voiced low: Cmaj7, Am7, Fmaj7, G6.
const CHORDS = [
  [130.81, 164.81, 196.00, 246.94],
  [110.00, 130.81, 164.81, 196.00],
  [87.31, 110.00, 130.81, 164.81],
  [98.00, 123.47, 146.83, 174.61],
];
const CHORD_SECONDS = 9;

function stopChord(nodes, when) {
  for (const { o, g } of nodes) {
    try {
      g.gain.setTargetAtTime(0.0001, when, 1.2);
      o.stop(when + 5);
    } catch { /* already stopped */ }
  }
}

function playChord(c) {
  const t = c.currentTime;
  const nodes = [];
  const freqs = CHORDS[chordIx % CHORDS.length];
  chordIx++;
  for (const f of freqs) {
    for (const det of [-2.5, 2.5]) {
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      o.detune.value = det;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.setTargetAtTime(0.014, t, 2.5);
      o.connect(g).connect(musicGain);
      o.start(t);
      nodes.push({ o, g });
    }
  }
  stopChord(chordNodes, t + 1);
  chordNodes = nodes;
}

export function setMusic(on) {
  musicOn = on;
  try {
    if (!on) {
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
      if (chordNodes.length) stopChord(chordNodes, ac().currentTime);
      chordNodes = [];
      return;
    }
    const c = ac();
    if (!musicGain) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 640;
      musicGain = c.createGain();
      musicGain.gain.value = muted ? 0 : 1;
      musicGain.connect(lp).connect(c.destination);
    }
    playChord(c);
    if (!musicTimer) musicTimer = setInterval(() => { if (musicOn && !muted) playChord(ac()); }, CHORD_SECONDS * 1000);
  } catch { /* audio is never worth crashing over */ }
}

export function isMusicOn() { return musicOn; }
