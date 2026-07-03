// Bootstrap: game loop, input, and the wiring between sim and UI.

import { createSim, tick } from '../core/sim.js';
import { serialize, deserialize } from '../core/save.js';
import { POWERS, castPower } from '../core/god.js';
import { dist } from '../core/world.js';
import { displayName } from '../core/character.js';
import {
  makeCamera, makeTerrain, render, renderMinimap, makeEffects, setRenderDt,
} from './render.js';
import {
  updateTopBar, buildPowerButtons, updatePowerButtons,
  renderInspector, makeChronicleFeed,
} from './panels.js';

const TICK_RATES = [0, 1.5, 6, 20]; // days per second per speed setting

const canvas = document.getElementById('map');
const ctx = canvas.getContext('2d');
const minimap = document.getElementById('minimap');
const mctx = minimap.getContext('2d');
const tooltip = document.getElementById('tooltip');

let sim, cam, effects, terrain, selection = null, selectedPower = null;
let speed = 1, tickAccum = 0, lastTime = performance.now();
let appendChronicle;
let hoverTile = null;
let inspectorDirty = true;
let follow = false;

const EFFECT_COLORS = {
  miracle: '#ffe9a0', wrath: '#ff5533', death: '#993333', battle: '#cc4444',
  war: '#cc4444', monster: '#cc7722', founding: '#88cc88', wedding: '#e8a0c0',
  birth: '#a0d8e8', triumph: '#ffd700', disaster: '#8899ff', plague: '#8a2be2',
  festival: '#f0c674', trade: '#a3c1ad', epithet: '#ffd700',
  prophecy: '#e6d5ff', schism: '#c99aff', dedication: '#e6e0ff',
};

const SAVE_KEY = 'vale-of-embers-save';

function saveWorld() {
  if (!sim || sim.extinct) return;
  try { localStorage.setItem(SAVE_KEY, serialize(sim)); } catch { /* storage full or blocked */ }
}

function loadWorld() {
  try {
    const json = localStorage.getItem(SAVE_KEY);
    if (!json) return null;
    return deserialize(json);
  } catch {
    return null;
  }
}

function newWorld(resume = false) {
  const saved = resume ? loadWorld() : null;
  if (!resume) localStorage.removeItem(SAVE_KEY);
  sim = saved ?? createSim(Math.floor(Math.random() * 2 ** 31));
  cam = makeCamera(canvas, sim.world.w, sim.world.h);
  terrain = makeTerrain(sim.world);
  effects = makeEffects();
  selection = null;
  selectedPower = null;
  follow = false;
  document.getElementById('gameover').classList.add('hidden');
  document.getElementById('chronicle-list').innerHTML = '';
  appendChronicle = makeChronicleFeed(sim, (x, y) => { cam.x = x; cam.y = y; follow = false; });
  sim.onChronicle = (e) => {
    appendChronicle(e);
    if (e.x !== undefined && e.importance >= 1) {
      effects.add(e.x, e.y, EFFECT_COLORS[e.kind] ?? '#ccc', e.importance >= 2);
    }
    if (e.fx === 'shake') effects.shake = 0.9;
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
  // Person first, then monster, then herd, then settlement, then the land.
  let best = null, bestD = 2.9;
  for (const p of sim.folk.values()) {
    if (!p.alive) continue;
    const d = dist(p.x, p.y, wx, wy);
    if (d < bestD) { bestD = d; best = { kind: 'person', ref: p }; }
  }
  if (best) return best;
  for (const m of sim.monsters.values()) {
    if (dist(m.x, m.y, wx, wy) < 3) return { kind: 'monster', ref: m };
  }
  for (const h of sim.herds.values()) {
    if (dist(h.x, h.y, wx, wy) < 3) return { kind: 'herd', ref: h };
  }
  for (const s of sim.settlements.values()) {
    if (s.members.size === 0) continue;
    if (dist(s.x, s.y, wx, wy) < 4) return { kind: 'settlement', ref: s };
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
  const key = selectedPower;
  const result = castPower(sim, key, target);
  if (result) {
    banner(result);
    effects.power(key, wx, wy);
    terrain.paintedDay = -1; // the land may have changed under this act
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
  updateTooltip(e.clientX - rect.left, e.clientY - rect.top);
  if (!dragging) return;
  const dx = e.clientX - lastMouse[0], dy = e.clientY - lastMouse[1];
  if (Math.abs(dx) + Math.abs(dy) > 3) dragMoved = true;
  cam.x -= dx / cam.zoom;
  cam.y -= dy / cam.zoom;
  if (dragMoved) follow = false;
  lastMouse = [e.clientX, e.clientY];
});
canvas.addEventListener('mouseleave', () => { hoverTile = null; tooltip.classList.add('hidden'); });
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

function updateTooltip(mx, my) {
  if (!hoverTile || dragging) { tooltip.classList.add('hidden'); return; }
  const picked = pickAt(hoverTile[0], hoverTile[1]);
  let text = null;
  if (picked.kind === 'person') {
    const p = picked.ref;
    text = displayName(p) + (p.activity ? ` — ${p.activity}` : '');
  } else if (picked.kind === 'monster') text = picked.ref.name;
  else if (picked.kind === 'herd') text = 'a herd of deer';
  else if (picked.kind === 'settlement') text = `${picked.ref.name} (${picked.ref.members.size})`;
  if (!text) { tooltip.classList.add('hidden'); return; }
  tooltip.textContent = text;
  tooltip.style.left = `${mx + 14}px`;
  tooltip.style.top = `${my + 8}px`;
  tooltip.classList.remove('hidden');
}

minimap.addEventListener('click', (e) => {
  const rect = minimap.getBoundingClientRect();
  cam.x = ((e.clientX - rect.left) / rect.width) * sim.world.w;
  cam.y = ((e.clientY - rect.top) / rect.height) * sim.world.h;
  follow = false;
});

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
    inspectorDirty = true;
  } else if (e.key === 'f' || e.key === 'F') {
    if (selection && (selection.kind === 'person' || selection.kind === 'monster' || selection.kind === 'herd')) {
      follow = !follow;
      banner(follow ? `Following ${selection.kind === 'person' ? displayName(selection.ref) : selection.ref.name ?? 'the herd'}.` : 'No longer following.');
    }
  }
});
document.getElementById('newworld').addEventListener('click', () => {
  if (sim.livingCount === 0 || confirm('Abandon this world and shape another?')) newWorld();
});
document.getElementById('gameover-new').addEventListener('click', newWorld);
document.getElementById('chronicle-minor').addEventListener('change', () => {
  document.getElementById('chronicle-list').innerHTML = '';
  appendChronicle = makeChronicleFeed(sim, (x, y) => { cam.x = x; cam.y = y; follow = false; });
});

buildPowerButtons((key) => {
  selectedPower = selectedPower === key ? null : key;
  inspectorDirty = true;
  if (selectedPower && POWERS[key].target === 'world') {
    const result = castPower(sim, key, {});
    if (result) { banner(result); effects.power(key, cam.x, cam.y); }
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
  setRenderDt(dt);

  tickAccum += dt * TICK_RATES[speed];
  let ticksThisFrame = 0;
  while (tickAccum >= 1 && ticksThisFrame < 30 && !sim.extinct) {
    tick(sim);
    tickAccum -= 1;
    ticksThisFrame++;
  }
  if (ticksThisFrame > 0) inspectorDirty = true;

  if (follow && selection?.ref && (selection.ref.alive ?? true)) {
    const e = selection.ref;
    cam.x += (e.x - cam.x) * Math.min(1, dt * 6);
    cam.y += (e.y - cam.y) * Math.min(1, dt * 6);
  }

  effects.step(dt);
  // Movement interpolation: how far through the current sim-day we are.
  const alpha = speed === 0 ? 1 : Math.min(1, tickAccum);
  render(ctx, sim, cam, selection, effects, hoverTile, alpha, terrain, now / 1000);
  renderMinimap(mctx, sim, cam, terrain);

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

newWorld(true);   // resume the last world if one was saved
resize();
requestAnimationFrame(frame);

// The world is remembered even when you look away.
setInterval(saveWorld, 30000);
window.addEventListener('pagehide', saveWorld);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') saveWorld();
});

// A window into the world, for the curious and for tests.
window.vale = {
  get sim() { return sim; },
  get cam() { return cam; },
  select(kindRefOrNull) { selection = kindRefOrNull; inspectorDirty = true; },
};
