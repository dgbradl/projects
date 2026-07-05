import './style.css';
import { G, hooks } from './state';
import { initLog } from './log';
import { initRender, renderFrame, setHover, clearHover, pickDungeonTile, pickCombatTile, pickOverworldNode } from './render';
import { initUI, refresh, showTitle, pendingSpell, clearPending, castNow } from './ui';
import * as dungeon from './dungeon';
import * as combat from './combat';
import * as overworld from './overworld';
import { WORLD } from './data';

const canvas = document.getElementById('map') as HTMLCanvasElement;

initLog();
initUI();
initRender(canvas);
hooks.refresh = refresh;

showTitle();

// debug/cheat handle (also handy for automated playtesting)
import * as state from './state';
(window as any).__dbg = { state, combat, dungeon, overworld, get G() { return G; } };

// ---------------------------------------------------------------- game loop

let lastT = 0;
function loop(t: number) {
  const dt = Math.min(100, t - lastT);
  lastT = t;
  if (G?.mode === 'combat') combat.combatTick(dt);
  walkTick(dt);
  renderFrame(t);
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);

// ---------------------------------------------------------------- auto-walk (dungeon click-to-move)

let walkPath: { x: number; y: number }[] = [];
let walkTimer = 0;

function walkTick(dt: number) {
  if (!walkPath.length || G?.mode !== 'dungeon') { if (G?.mode !== 'dungeon') walkPath = []; return; }
  walkTimer += dt;
  if (walkTimer < 130) return;
  walkTimer = 0;
  const dn = G.dungeon!;
  const next = walkPath.shift()!;
  const ok = dungeon.step(next.x - dn.px, next.y - dn.py);
  if (!ok || G.mode !== 'dungeon') walkPath = [];
}

function pathTo(tx: number, ty: number): { x: number; y: number }[] | null {
  const dn = G.dungeon!;
  const pass = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= dn.w || y >= dn.h) return false;
    const t = dn.tiles[y * dn.w + x];
    if (!t.seen) return false;
    if (t.t === 'wall') return false;
    if (t.t === 'secret' && !t.found) return false;
    return true;
  };
  if (!pass(tx, ty)) return null;
  const prev = new Int32Array(dn.w * dn.h).fill(-2);
  prev[dn.py * dn.w + dn.px] = -1;
  const q = [[dn.px, dn.py]];
  while (q.length) {
    const [x, y] = q.shift()!;
    if (x === tx && y === ty) {
      const path: { x: number; y: number }[] = [];
      let cur = y * dn.w + x;
      while (prev[cur] !== -1) {
        path.unshift({ x: cur % dn.w, y: Math.floor(cur / dn.w) });
        cur = prev[cur];
      }
      return path;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!pass(nx, ny)) continue;
      const k = ny * dn.w + nx;
      if (prev[k] !== -2) continue;
      prev[k] = y * dn.w + x;
      q.push([nx, ny]);
    }
  }
  return null;
}

// ---------------------------------------------------------------- input

function canvasPos(e: MouseEvent): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

canvas.addEventListener('mousemove', e => {
  const p = canvasPos(e);
  setHover(p.x, p.y);
});
canvas.addEventListener('mouseleave', () => clearHover());

canvas.addEventListener('click', e => {
  if (!G) return;
  const p = canvasPos(e);

  if (G.mode === 'overworld') {
    const id = pickOverworldNode(p.x, p.y);
    if (!id) return;
    const here = WORLD[G.location];
    if (id === G.location) {
      if (here.kind === 'dungeon' || here.kind === 'cave') dungeon.enterDungeon(id);
      else if (here.kind === 'town') { G.mode = 'town'; overworld.arrive(); hooks.refresh(); }
    } else if (here.links.includes(id)) {
      overworld.travelTo(id);
    }
    return;
  }

  if (G.mode === 'dungeon') {
    const t = pickDungeonTile(p.x, p.y);
    if (!t) return;
    const path = pathTo(t.x, t.y);
    if (path) { walkPath = path; walkTimer = 999; }
    return;
  }

  if (G.mode === 'combat') {
    const cur = combat.current();
    if (!cur || cur.kind !== 'pc') return;
    const t = pickCombatTile(p.x, p.y);
    if (!t) return;
    const targetMon = G.combat!.order.find(o =>
      o.kind === 'monster' && o.x === t.x && o.y === t.y &&
      o.mon!.hp > 0 && !o.mon!.fled && !o.mon!.asleep);

    if (pendingSpell && targetMon) {
      castNow(cur, pendingSpell.spellId, targetMon, pendingSpell.fromScroll);
      return;
    }
    if (pendingSpell) return; // must click an enemy or cancel

    if (targetMon) {
      combat.pcAttack(cur, targetMon);
      return;
    }
    combat.pcMove(cur, t.x, t.y);
    refresh();
  }
});

window.addEventListener('keydown', e => {
  if (!G) return;
  if (e.key === 'Escape') { clearPending(); refresh(); return; }
  if (G.mode !== 'dungeon') return;
  const dirs: Record<string, [number, number]> = {
    ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    w: [0, -1], s: [0, 1], a: [-1, 0], d: [1, 0],
    W: [0, -1], S: [0, 1], A: [-1, 0], D: [1, 0],
  };
  const d = dirs[e.key];
  if (d) {
    e.preventDefault();
    walkPath = [];
    dungeon.step(d[0], d[1]);
  }
});
