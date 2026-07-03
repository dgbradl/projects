// The vale's voice, synthesized from nothing: wind that rises with storms,
// rain on the roof, birdsong in the green months, bells for weddings,
// drums for war, thunder for the god's wrath. No audio files — WebAudio only.

import { seasonOf } from '../core/world.js';

let ctx = null;
let master, windGain, rainGain, windFilter;
let muted = false;
let lastStinger = 0;
let birdTimer = 0;

function noiseBuffer(seconds) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

export function initAudio() {
  if (ctx) return;
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
  } catch {
    return;
  }
  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.5;
  master.connect(ctx.destination);

  // Wind: endless filtered noise, gain steered by the weather.
  const windSrc = ctx.createBufferSource();
  windSrc.buffer = noiseBuffer(4);
  windSrc.loop = true;
  windFilter = ctx.createBiquadFilter();
  windFilter.type = 'lowpass';
  windFilter.frequency.value = 350;
  windGain = ctx.createGain();
  windGain.gain.value = 0.04;
  windSrc.connect(windFilter).connect(windGain).connect(master);
  windSrc.start();

  // Rain: brighter noise band, silent until it rains.
  const rainSrc = ctx.createBufferSource();
  rainSrc.buffer = noiseBuffer(3);
  rainSrc.loop = true;
  const rainHp = ctx.createBiquadFilter();
  rainHp.type = 'highpass';
  rainHp.frequency.value = 1400;
  const rainLp = ctx.createBiquadFilter();
  rainLp.type = 'lowpass';
  rainLp.frequency.value = 6500;
  rainGain = ctx.createGain();
  rainGain.gain.value = 0;
  rainSrc.connect(rainHp).connect(rainLp).connect(rainGain).connect(master);
  rainSrc.start();
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.5, ctx.currentTime, 0.1);
  return muted;
}

export function isMuted() { return muted; }

// Steer the ambience toward the current weather and season.
export function updateAmbience(sim, dt) {
  if (!ctx || muted) return;
  const t = ctx.currentTime;
  const storm = sim.weather.storm;
  const raining = sim.weather.rainDays > 0 || storm;
  const winter = seasonOf(sim.day) === 'winter';

  windGain.gain.setTargetAtTime(storm ? 0.16 : winter ? 0.09 : 0.04, t, 0.8);
  windFilter.frequency.setTargetAtTime(storm ? 700 : 350, t, 0.8);
  rainGain.gain.setTargetAtTime(raining ? (storm ? 0.09 : 0.05) : 0, t, 0.6);

  // Birdsong in the green months.
  const season = seasonOf(sim.day);
  if (season === 'spring' || season === 'summer') {
    birdTimer -= dt;
    if (birdTimer <= 0) {
      birdTimer = 2 + Math.random() * 6;
      chirp();
    }
  }
}

function chirp() {
  const t = ctx.currentTime;
  const notes = 2 + (Math.random() * 3 | 0);
  for (let i = 0; i < notes; i++) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const start = t + i * (0.07 + Math.random() * 0.05);
    const f0 = 2400 + Math.random() * 1600;
    osc.frequency.setValueAtTime(f0, start);
    osc.frequency.exponentialRampToValueAtTime(f0 * (0.8 + Math.random() * 0.5), start + 0.06);
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(0.025, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.09);
    osc.connect(g).connect(master);
    osc.start(start);
    osc.stop(start + 0.12);
  }
}

// ---- stingers: little musical punctuation for the chronicle ----
function tone(freq, start, dur, peak, type = 'sine') {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(peak, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g).connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.1);
}

function noiseBurst(start, dur, peak, lowpassHz) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(Math.min(2, dur + 0.2));
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(lowpassHz, start);
  f.frequency.exponentialRampToValueAtTime(Math.max(60, lowpassHz * 0.2), start + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(peak, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(f).connect(g).connect(master);
  src.start(start);
  src.stop(start + dur + 0.2);
}

export function stinger(kind) {
  if (!ctx || muted) return;
  const now = performance.now();
  if (now - lastStinger < 900) return;   // never a wall of bells
  lastStinger = now;
  const t = ctx.currentTime;
  switch (kind) {
    case 'wedding':
      tone(880, t, 1.4, 0.06);
      tone(1318, t + 0.18, 1.6, 0.05);
      tone(2637, t + 0.18, 0.7, 0.015);
      break;
    case 'war': {
      // A low drum, twice.
      for (const dt of [0, 0.32]) {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.frequency.setValueAtTime(95, t + dt);
        osc.frequency.exponentialRampToValueAtTime(45, t + dt + 0.25);
        g.gain.setValueAtTime(0, t + dt);
        g.gain.linearRampToValueAtTime(0.14, t + dt + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dt + 0.4);
        osc.connect(g).connect(master);
        osc.start(t + dt);
        osc.stop(t + dt + 0.5);
      }
      noiseBurst(t, 0.15, 0.03, 900);
      break;
    }
    case 'thunder':
      noiseBurst(t, 2.2, 0.16, 320);
      tone(55, t, 1.8, 0.08);
      break;
    case 'miracle':
      // A soft major chord blooming and fading.
      tone(523, t, 2.4, 0.035);
      tone(659, t + 0.1, 2.4, 0.03);
      tone(784, t + 0.2, 2.6, 0.03);
      break;
    case 'doom':
      // A deep gong for world-shaking news.
      tone(110, t, 3.2, 0.1);
      tone(163, t + 0.05, 2.6, 0.05);
      noiseBurst(t, 0.5, 0.03, 500);
      break;
  }
}
