// Bootstrap: game loop, input handling, autosave.

import { GRID } from './defs.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';

const game = new Game();
game.load();

const canvas = document.getElementById('game');
const renderer = new Renderer(canvas, game);
const ui = new UI(game);

let hover = null;

window.addEventListener('resize', () => renderer.resize());
// The canvas may lay out after fonts/panels settle; re-measure next frame.
requestAnimationFrame(() => renderer.resize());

function eventTile(e) {
  const rect = canvas.getBoundingClientRect();
  const { x, y } = renderer.toGrid(e.clientX - rect.left, e.clientY - rect.top);
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return null;
  return { x, y };
}

canvas.addEventListener('mousemove', (e) => { hover = eventTile(e); });
canvas.addEventListener('mouseleave', () => { hover = null; });

canvas.addEventListener('mousedown', (e) => {
  const t = eventTile(e);
  if (!t) return;
  if (e.button === 2 || ui.tool === 'demolish') {
    game.demolish(t.x, t.y);
    return;
  }
  if (e.button !== 0) return;
  if (ui.tool === 'select') {
    ui.selected = game.cell(t.x, t.y) ? { x: t.x, y: t.y } : null;
    return;
  }
  game.place(ui.tool, t.x, t.y, ui.dir);
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('keydown', (e) => {
  if (e.key === 'r' || e.key === 'R') ui.dir = (ui.dir + 1) % 4;
  if (e.key === 'Escape') ui.setTool('select');
});

// Fixed-step simulation so speed multipliers stay deterministic-ish.
const STEP = 1 / 60;
let last = performance.now();
let acc = 0;
let saveTimer = 0;

function frame(now) {
  const real = Math.min(0.25, (now - last) / 1000);
  last = now;
  acc += real * game.speed;
  while (acc >= STEP) {
    game.tick(STEP);
    acc -= STEP;
  }

  saveTimer += real;
  if (saveTimer > 5) {
    saveTimer = 0;
    game.save();
  }

  const ghost = (ui.tool !== 'select' && ui.tool !== 'demolish' && hover)
    ? { type: ui.tool, x: hover.x, y: hover.y, dir: ui.dir }
    : null;
  renderer.draw(hover, ghost);
  ui.refresh();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.addEventListener('beforeunload', () => game.save());

// Console access for debugging.
window.game = game;
window.ui = ui;
