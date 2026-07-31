// Bootstrap: game loop, map input, autosave.

import { GRID } from './defs.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';

const game = new Game();
const loaded = game.load();

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas, game);
const ui = new UI(game, { fresh: !loaded });

let hover = null;

window.addEventListener('resize', () => renderer.resize());
requestAnimationFrame(() => renderer.resize());

function eventTile(e) {
  const rect = canvas.getBoundingClientRect();
  const { x, y } = renderer.toGrid(e.clientX - rect.left, e.clientY - rect.top);
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return null;
  return { x, y };
}

// Pointer input: tap/click selects, drag pans, wheel zooms, double-click resets.
let pointer = null;
canvas.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  canvas.setPointerCapture(e.pointerId);
  pointer = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false };
});
canvas.addEventListener('pointermove', (e) => {
  hover = eventTile(e);
  canvas.style.cursor = hover && game.siteAtTile(hover.x, hover.y) ? 'pointer' : 'default';
  ui.updateMapTip(e.clientX, e.clientY, hover);
  if (pointer && e.pointerId === pointer.id) {
    const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
    if (pointer.moved || Math.hypot(dx, dy) > 6) {
      pointer.moved = true;
      renderer.pan(dx, dy);
      pointer.x = e.clientX;
      pointer.y = e.clientY;
    }
  }
});
canvas.addEventListener('pointerup', (e) => {
  if (pointer && e.pointerId === pointer.id) {
    if (!pointer.moved) {
      const t = eventTile(e);
      if (t) ui.clickTile(t.x, t.y);
    }
    pointer = null;
  }
});
canvas.addEventListener('pointercancel', () => { pointer = null; });
canvas.addEventListener('mouseleave', () => {
  hover = null;
  document.getElementById('map-tip').classList.add('hidden');
});
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const rect = canvas.getBoundingClientRect();
  renderer.setZoom(
    renderer.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15),
    e.clientX - rect.left, e.clientY - rect.top,
  );
}, { passive: false });
canvas.addEventListener('dblclick', () => renderer.resetView());

// On-screen zoom controls (important on touch devices).
document.getElementById('zoom-in').addEventListener('click', () => renderer.setZoom(renderer.zoom * 1.25));
document.getElementById('zoom-out').addEventListener('click', () => renderer.setZoom(renderer.zoom / 1.25));
document.getElementById('zoom-reset').addEventListener('click', () => renderer.resetView());

// Keyboard shortcuts: space pauses, 1/2/3 set speed, Esc closes overlays.
let lastSpeed = 1;
window.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') {
    e.preventDefault();
    if (game.speed > 0) { lastSpeed = game.speed; game.speed = 0; }
    else game.speed = lastSpeed;
  } else if (e.key === '1') game.speed = 1;
  else if (e.key === '2') game.speed = 3;
  else if (e.key === '3') game.speed = 8;
  else if (e.key === 'Escape') ui.closeOverlays();
});

// Fixed-step sim. dt is in DAYS: DAY_LENGTH real seconds = 1 game day at 1x.
import { DAY_LENGTH } from './defs.js';
const STEP = 1 / 60 / DAY_LENGTH;   // one 60fps frame's worth of game-days
let last = performance.now();
let acc = 0;
let saveTimer = 0;

function frame(now) {
  const real = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += (real / DAY_LENGTH) * game.speed;
  let steps = 0;
  while (acc >= STEP && steps < 240) {
    game.tick(STEP);
    acc -= STEP;
    steps++;
  }

  saveTimer += real;
  if (saveTimer > 5) {
    saveTimer = 0;
    game.save();
  }

  renderer.draw(hover, ui.selectedSite);
  ui.refresh();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => game.save());

// Console access for debugging.
window.game = game;
window.ui = ui;
window.renderer = renderer;
