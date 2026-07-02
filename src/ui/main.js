// Bootstrap: game loop, input, and the wiring between sim and UI.

import { createSim, tick } from '../core/sim.js';
import { POWERS, castPower } from '../core/god.js';
import { dist } from '../core/world.js';
import {
  makeCamera, render, makeEffects,
} from './render.js';
import {
  updateTopBar, buildPowerButtons, updatePowerButtons,
  renderInspector, makeChronicleFeed,
} from './panels.js';

const TICK_RATES = [0, 1.5, 6, 20]; // days per second per speed setting

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');

let sim, cam, effects, selection = null, selectedPower = null;
let speed = 1, tickAccum = 0, lastTime = performance.now();
let appendChronicle;
let hoverTile = null;
let inspectorDirty = true;

const EFFECT_COLORS = {
  miracle: '#ffe9a0', wrath: '#ff5533', death: '#993333', battle: '#cc4444',
  war: '#cc4444', monster: '#cc7722', founding: '#88cc88', wedding: '#e8a0c0',
  birth: '#a0d8e8', triumph: '#ffd700', disaster: '#8899ff', plague: '#8a2be2',
};

function newWorld() {
  const seed = Math.floor(Math.random() * 2 ** 31);
  sim = createSim(seed);
  cam = makeCamera(canvas, sim.world.w, sim.world.h);
  effects = makeEffects();
  selection = null;
  selectedPower = null;
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('chronicle-list').innerHTML = '';
  appendChronicle = makeChronicleFeed(sim, (x, y) => { cam.x = x; cam.y = y; });
  sim.onChronicle = (e) => {
    appendChronicle(e);
    if (e.x !== undefined && e.importance >= 1) {
      effects.add(e.x, e.y, EFFECT_COLORS[e.kind] ?? '#ccc', e.importance >= 2);
    }
    if (e.kind === 'extinction') showGameOver();
    inspectorDirty = true;
  };
  inspectorDirty = true;
}

function showGameOver() {
  const years = Math.floor(sim.day / 96);
  document.getElementById('gameover-text').textContent =
    `For ${years} years the folk of the vale loved, built, feuded and endured. ` +
    `At their height they numbered ${sim.peakPopulation}. Now only the wind remains — ` +
    `and a god, alone with the chronicle of everything that was.`;
  document.getElementById('gameover').classList.remove('hidden');
}

// ---- selection & casting ----
function pickAt(wx, wy) {
  // Person first, then monster, then settlement, then the land itself.
  let best = null, bestD = 2.9;
  for (const p of sim.folk.values()) {
    if (!p.alive) continue;
    const d = dist(p.x, p.y, wx, wy);
    if (d < bestD) { bestD = d; best = { kind: 'person', ref: p }; }
  }
  if (best) return best;
  for (const m of sim.monsters.values()) {
    const d = dist(m.x, m.y, wx, wy);
    if (d < 3) return { kind: 'monster', ref: m };
  }
  for (const s of sim.settlements.values()) {
    if (s.members.size === 0) continue;
    const d = dist(s.x, s.y, wx, wy);
    if (d < 4) return { kind: 'settlement', ref: s };
  }
  return { kind: 'tile', x: wx, y: wy };
}

function banner(text) {
  const el = document.getElementById('cast-banner');
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(banner.timer);
  banner.timer = setTimeout(() => el.classList.add('hidden'), 2600);
}

function tryCast(wx, wy) {
  const power = POWERS[selectedPower];
  const picked = pickAt(wx, wy);
  let target = null;
  if (power.target === 'tile' || power.target === 'world') target = { x: wx, y: wy };
  else if (power.target === 'person') {
    if (picked.kind !== 'person') { banner('Choose one of the folk.'); return; }
    target = { person: picked.ref };
  } else if (power.target === 'settlement') {
    if (picked.kind !== 'settlement') { banner('Choose a settlement.'); return; }
    target = { settlement: picked.ref };
  }
  const result = castPower(sim, selectedPower, target);
  if (result) {
    banner(result);
    effects.add(wx, wy, selectedPower === 'blight' || selectedPower === 'lightning' || selectedPower === 'quake' || selectedPower === 'beast' ? '#ff5533' : '#ffe9a0', true);
    selectedPower = null;
    inspectorDirty = true;
  }
}

// ---- input ----
let dragging = false, dragMoved = false, lastMouse = null;

canvas.addEventListener('mousedown', (e) => { dragging = true; dragMoved = false; lastMouse = [e.clientX, e.clientY]; });
window.addEventListener('mouseup', () => { dragging = false; });
canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  hoverTile = cam.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  if (!dragging) return;
  const dx = e.clientX - lastMouse[0], dy = e.clientY - lastMouse[1];
  if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
  cam.x -= dx / cam.zoom;
  cam.y -= dy / cam.zoom;
  lastMouse = [e.clientX, e.clientY];
});
canvas.addEventListener('click', (e) => {
  if (dragMoved) return;
  const rect = canvas.getBoundingClientRect();
  const [wx, wy] = cam.toWorld(e.clientX - rect.left, e.clientY - rect.top);
  if (selectedPower) { tryCast(wx, wy); return; }
  selection = pickAt(wx, wy);
  inspectorDirty = true;
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
  cam.zoom = Math.max(3, Math.min(28, cam.zoom * factor));
}, { passive: false });

document.querySelectorAll('#speed-controls button').forEach((btn) => {
  btn.addEventListener('click', () => {
    speed = Number(btn.dataset.speed);
    document.querySelectorAll('#speed-controls button').forEach((b) => b.classList.toggle('active', b === btn));
  });
});
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') {
    e.preventDefault();
    const target = speed === 0 ? 1 : 0;
    document.querySelector(`#speed-controls button[data-speed="${target}"]`).click();
  } else if (e.key === 'Escape') {
    selectedPower = null;
  }
});
document.getElementById('newworld').addEventListener('click', () => {
  if (sim.livingCount === 0 || confirm('Abandon this world and shape another?')) newWorld();
});
document.getElementById('gameover-new').addEventListener('click', newWorld);
document.getElementById('chronicle-minor').addEventListener('change', () => {
  document.getElementById('chronicle-list').innerHTML = '';
  appendChronicle = makeChronicleFeed(sim, (x, y) => { cam.x = x; cam.y = y; });
});

buildPowerButtons((key) => {
  selectedPower = selectedPower === key ? null : key;
  inspectorDirty = true;
  if (selectedPower && POWERS[key].target === 'world') {
    const result = castPower(sim, key, {});
    if (result) banner(result);
    selectedPower = null;
  } else if (selectedPower) {
    banner(`${POWERS[key].name}: choose your ${POWERS[key].target === 'person' ? 'soul' : POWERS[key].target === 'settlement' ? 'settlement' : 'place'}.`);
  }
});

// ---- resize & loop ----
function resize() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
}
window.addEventListener('resize', resize);

let uiClock = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - lastTime) / 1000);
  lastTime = now;

  tickAccum += dt * TICK_RATES[speed];
  let ticksThisFrame = 0;
  while (tickAccum >= 1 && ticksThisFrame < 30 && !sim.extinct) {
    tick(sim);
    tickAccum -= 1;
    ticksThisFrame++;
  }
  if (ticksThisFrame > 0) inspectorDirty = true;

  effects.step(dt);
  render(ctx, sim, cam, selection, effects, hoverTile);

  uiClock += dt;
  if (inspectorDirty && uiClock > 0.25) {
    uiClock = 0;
    inspectorDirty = false;
    updateTopBar(sim);
    updatePowerButtons(sim, selectedPower);
    renderInspector(sim, selection, (sel) => { selection = sel; inspectorDirty = true; });
  }
  requestAnimationFrame(frame);
}

newWorld();
resize();
requestAnimationFrame(frame);
