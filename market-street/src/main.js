// Bootstrap: game loop, map input, autosave.

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
requestAnimationFrame(() => renderer.resize());

function eventTile(e) {
  const rect = canvas.getBoundingClientRect();
  const { x, y } = renderer.toGrid(e.clientX - rect.left, e.clientY - rect.top);
  if (x < 0 || y < 0 || x >= GRID || y >= GRID) return null;
  return { x, y };
}

canvas.addEventListener('mousemove', (e) => {
  hover = eventTile(e);
  canvas.style.cursor = hover && game.siteAtTile(hover.x, hover.y) ? 'pointer' : 'default';
});
canvas.addEventListener('mouseleave', () => { hover = null; });
canvas.addEventListener('mousedown', (e) => {
  if (e.button !== 0) return;
  const t = eventTile(e);
  if (t) ui.clickTile(t.x, t.y);
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
