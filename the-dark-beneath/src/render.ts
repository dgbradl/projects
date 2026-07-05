// Canvas renderer: overworld parchment map, dungeon fog + torchlight,
// combat grid, town night scene. All drawing is procedural — no assets.
import { G } from './state';
import { WORLD, MONSTERS } from './data';
import { computeVisibility, lineOfSight, lightRadius } from './dungeon';
import { current, blocked } from './combat';
import type { Combatant } from './types';

let canvas: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let W = 0, H = 0, dpr = 1;
let hover: { x: number; y: number } | null = null;

export const CLASS_COLORS: Record<string, string> = {
  Fighter: '#b5442d',
  Thief: '#5e8a52',
  Priest: '#d8b45a',
  Wizard: '#7a6aba',
};

const THEMES: Record<string, { floor: string; floor2: string; wall: string; wallTop: string }> = {
  crypt: { floor: '#3d4148', floor2: '#363a41', wall: '#191b20', wallTop: '#2a2d34' },
  warren: { floor: '#4a3f2e', floor2: '#443a2a', wall: '#1e1811', wallTop: '#332a1d' },
  mine: { floor: '#453a32', floor2: '#3e342c', wall: '#1a140f', wallTop: '#2e2620' },
  spire: { floor: '#3d3546', floor2: '#37303f', wall: '#171320', wallTop: '#292233' },
  cave: { floor: '#41403a', floor2: '#3a3934', wall: '#16150f', wallTop: '#292823' },
  road: { floor: '#3d4434', floor2: '#37402f', wall: '#1a1e14', wallTop: '#2d3325' },
};

export function initRender(cv: HTMLCanvasElement) {
  canvas = cv;
  ctx = cv.getContext('2d')!;
  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.max(1, Math.round(W * dpr));
    cv.height = Math.max(1, Math.round(H * dpr));
  };
  new ResizeObserver(resize).observe(cv);
  resize();
}

export function setHover(mx: number, my: number) { hover = { x: mx, y: my }; }
export function clearHover() { hover = null; }

// deterministic per-tile noise
function hash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function flicker(t: number): number {
  return 0.9 + 0.06 * Math.sin(t * 0.006) + 0.04 * Math.sin(t * 0.017 + 1.7);
}

// ---------------------------------------------------------------- frame

export function renderFrame(t: number) {
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  if (!G) { drawEmber(t); return; }
  switch (G.mode) {
    case 'dungeon': drawDungeon(t); break;
    case 'combat': drawCombat(t); break;
    case 'overworld': drawOverworld(t); break;
    case 'town': drawTown(t); break;
    default: drawEmber(t); break;
  }
}

// ---------------------------------------------------------------- ember (title bg)

function drawEmber(t: number) {
  ctx.fillStyle = '#0b0705';
  ctx.fillRect(0, 0, W, H);
  const f = flicker(t);
  const cx = W / 2, cy = H * 0.55;
  const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 240 * f);
  g.addColorStop(0, 'rgba(255,180,90,0.5)');
  g.addColorStop(0.4, 'rgba(200,90,30,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

// ---------------------------------------------------------------- dungeon

function dungeonLayout() {
  const dn = G.dungeon!;
  const tile = Math.floor(Math.min(W / dn.w, H / dn.h));
  return { tile, ox: Math.floor((W - tile * dn.w) / 2), oy: Math.floor((H - tile * dn.h) / 2) };
}

export function pickDungeonTile(mx: number, my: number): { x: number; y: number } | null {
  if (!G?.dungeon) return null;
  const { tile, ox, oy } = dungeonLayout();
  const x = Math.floor((mx - ox) / tile), y = Math.floor((my - oy) / tile);
  if (x < 0 || y < 0 || x >= G.dungeon.w || y >= G.dungeon.h) return null;
  return { x, y };
}

function drawDungeon(t: number) {
  const dn = G.dungeon!;
  const { tile, ox, oy } = dungeonLayout();
  const th = THEMES[dn.theme] ?? THEMES.cave;
  const lum = computeVisibility();
  const f = flicker(t);

  ctx.fillStyle = '#050403';
  ctx.fillRect(0, 0, W, H);

  for (let y = 0; y < dn.h; y++) {
    for (let x = 0; x < dn.w; x++) {
      const i = y * dn.w + x;
      const tl = dn.tiles[i];
      if (!tl.seen) continue;
      const light = Math.max(0.26, Math.min(1, 0.1 + lum[i] * f * 1.5));
      const px = ox + x * tile, py = oy + y * tile;

      ctx.globalAlpha = 1;
      if (tl.t === 'wall') {
        ctx.fillStyle = th.wall;
        ctx.fillRect(px, py, tile, tile);
        ctx.fillStyle = th.wallTop;
        ctx.fillRect(px, py, tile, Math.max(2, tile * 0.18));
      } else {
        ctx.fillStyle = hash(x, y) > 0.5 ? th.floor : th.floor2;
        ctx.fillRect(px, py, tile, tile);
        if (hash(x * 7, y * 3) > 0.85) { // cracks
          ctx.fillStyle = 'rgba(0,0,0,0.22)';
          ctx.fillRect(px + tile * 0.3, py + tile * 0.55, tile * 0.4, 2);
        }
        drawFeature(tl, px, py, tile, t, x, y);
      }
      // darkness overlay
      ctx.fillStyle = `rgba(4,3,2,${(1 - light).toFixed(3)})`;
      ctx.fillRect(px, py, tile, tile);
    }
  }

  // warm torch glow (additive)
  const sources: { x: number; y: number; r: number; s: number }[] = [];
  if (lightRadius() > 1) sources.push({ x: dn.px, y: dn.py, r: lightRadius() + 0.5, s: 0.32 });
  for (let i = 0; i < dn.tiles.length; i++) {
    if (dn.tiles[i].t === 'brazier' && dn.tiles[i].seen) sources.push({ x: i % dn.w, y: Math.floor(i / dn.w), r: 3.2, s: 0.22 });
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const s of sources) {
    const cx = ox + (s.x + 0.5) * tile, cy = oy + (s.y + 0.5) * tile;
    const rad = s.r * tile * f;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(255,175,85,${Math.min(1, s.s * 1.4 * f)})`);
    g.addColorStop(0.55, `rgba(255,125,45,${s.s * 0.45 * f})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  ctx.globalCompositeOperation = 'source-over';

  // monsters in sight
  for (const g of dn.groups) {
    if (g.dead) continue;
    const i = g.y * dn.w + g.x;
    if (lum[i] < 0.06 || !lineOfSight(dn.px, dn.py, g.x, g.y)) continue;
    const def = MONSTERS[g.defId];
    const cx = ox + (g.x + 0.5) * tile, cy = oy + (g.y + 0.5) * tile;
    drawToken(cx, cy, tile * 0.38, def.color, def.glyph.toUpperCase(), g.alerted ? '#e06c5a' : '#111');
    if (g.count > 1) {
      ctx.fillStyle = '#e6d5ac';
      ctx.font = `bold ${Math.max(9, tile * 0.28)}px Palatino, serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`×${g.count}`, cx + tile * 0.34, cy - tile * 0.3);
    }
  }

  // party token
  drawPartyToken(ox + (dn.px + 0.5) * tile, oy + (dn.py + 0.5) * tile, tile, t);

  // hover highlight
  if (hover) {
    const h = pickDungeonTile(hover.x, hover.y);
    if (h && Math.abs(h.x - dn.px) <= 1 && Math.abs(h.y - dn.py) <= 1 && !(h.x === dn.px && h.y === dn.py)) {
      ctx.strokeStyle = 'rgba(255,180,90,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(ox + h.x * tile + 1.5, oy + h.y * tile + 1.5, tile - 3, tile - 3);
    }
  }
}

function drawFeature(tl: { t: string; open?: boolean; found?: boolean; looted?: boolean }, px: number, py: number, tile: number, t: number, x: number, y: number) {
  const cx = px + tile / 2, cy = py + tile / 2;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  switch (tl.t) {
    case 'door': case 'locked':
      if (tl.open) {
        ctx.fillStyle = '#4a3423';
        ctx.fillRect(px, py, tile * 0.14, tile);
        ctx.fillRect(px + tile * 0.86, py, tile * 0.14, tile);
      } else {
        ctx.fillStyle = '#5d4228';
        ctx.fillRect(px + tile * 0.08, py + tile * 0.12, tile * 0.84, tile * 0.76);
        ctx.fillStyle = '#3a2a18';
        ctx.fillRect(px + tile * 0.08, py + tile * 0.46, tile * 0.84, 2);
        if (tl.t === 'locked') {
          ctx.fillStyle = '#d8b45a';
          ctx.fillRect(cx - 2, cy - 2, 5, 6);
        }
      }
      break;
    case 'secret':
      if (tl.found && !tl.open) {
        ctx.fillStyle = '#4a4258';
        ctx.fillRect(px + tile * 0.08, py + tile * 0.12, tile * 0.84, tile * 0.76);
        ctx.fillStyle = '#8a7ab8';
        ctx.font = `${tile * 0.5}px serif`;
        ctx.fillText('?', cx, cy + 1);
      } else if (tl.open) {
        ctx.fillStyle = '#332e40';
        ctx.fillRect(px, py, tile * 0.14, tile);
        ctx.fillRect(px + tile * 0.86, py, tile * 0.14, tile);
      }
      break;
    case 'chest': {
      ctx.fillStyle = tl.looted ? '#4a3d2a' : '#7a5c2e';
      ctx.fillRect(px + tile * 0.2, py + tile * 0.32, tile * 0.6, tile * 0.42);
      ctx.fillStyle = tl.looted ? '#5d4c35' : '#d8b45a';
      ctx.fillRect(px + tile * 0.2, py + tile * 0.44, tile * 0.6, 2);
      break;
    }
    case 'trap':
      if (tl.found && !tl.looted) {
        ctx.strokeStyle = '#c05a48';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, py + tile * 0.25);
        ctx.lineTo(px + tile * 0.75, py + tile * 0.7);
        ctx.lineTo(px + tile * 0.25, py + tile * 0.7);
        ctx.closePath();
        ctx.stroke();
      } else if (tl.looted) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(px + tile * 0.2, py + tile * 0.2, tile * 0.6, tile * 0.6);
      }
      break;
    case 'brazier': {
      ctx.fillStyle = '#33261a';
      ctx.fillRect(cx - tile * 0.16, cy, tile * 0.32, tile * 0.3);
      const ff = 0.8 + 0.2 * Math.sin(t * 0.012 + x * 3 + y);
      ctx.fillStyle = `rgba(255,${140 + 40 * ff},60,0.95)`;
      ctx.beginPath();
      ctx.ellipse(cx, cy - tile * 0.08, tile * 0.12, tile * 0.2 * ff, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'altar':
      ctx.fillStyle = tl.looted ? '#c8c2b0' : '#8a8578';
      ctx.fillRect(px + tile * 0.22, py + tile * 0.3, tile * 0.56, tile * 0.44);
      ctx.fillStyle = tl.looted ? '#fff8e0' : '#5a564c';
      ctx.fillRect(cx - 1.5, py + tile * 0.36, 3, tile * 0.3);
      ctx.fillRect(cx - tile * 0.12, py + tile * 0.44, tile * 0.24, 3);
      break;
    case 'water': {
      ctx.fillStyle = '#1d2c3d';
      ctx.fillRect(px, py, tile, tile);
      ctx.strokeStyle = `rgba(120,160,200,${0.25 + 0.15 * Math.sin(t * 0.003 + x + y * 2)})`;
      ctx.beginPath();
      ctx.moveTo(px + tile * 0.15, cy);
      ctx.quadraticCurveTo(cx, cy - tile * 0.14, px + tile * 0.85, cy);
      ctx.stroke();
      break;
    }
    case 'rubble':
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (let k = 0; k < 5; k++) {
        const rx = px + tile * (0.2 + 0.6 * hash(x * 5 + k, y * 9));
        const ry = py + tile * (0.2 + 0.6 * hash(x * 9, y * 5 + k));
        ctx.fillRect(rx, ry, tile * 0.14, tile * 0.1);
      }
      break;
    case 'exit': case 'stairs': {
      ctx.fillStyle = '#1a150f';
      ctx.fillRect(px + tile * 0.15, py + tile * 0.15, tile * 0.7, tile * 0.7);
      ctx.strokeStyle = '#8a7a5d';
      ctx.lineWidth = 1.5;
      for (let k = 1; k <= 3; k++) {
        const w2 = tile * 0.7 * (1 - k * 0.22);
        ctx.strokeRect(cx - w2 / 2, py + tile * (0.15 + k * 0.16), w2, tile * 0.1);
      }
      break;
    }
  }
}

function drawToken(cx: number, cy: number, r: number, color: string, glyph: string, ring: string) {
  ctx.beginPath();
  ctx.arc(cx, cy + r * 0.15, r * 0.9, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.fillStyle = '#0e0b08';
  ctx.font = `bold ${r * 1.1}px Palatino, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, cx, cy + 1);
}

function drawPartyToken(cx: number, cy: number, tile: number, t: number) {
  const r = tile * 0.4;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = '#d8d0bd';
  ctx.fill();
  ctx.strokeStyle = '#221a12';
  ctx.lineWidth = 2;
  ctx.stroke();
  // quadrant dots: the four classes
  const members = G.party.filter(p => p.alive);
  members.slice(0, 4).forEach((p, i) => {
    const a = (i / Math.max(1, members.length)) * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r * 0.5, cy + Math.sin(a) * r * 0.5, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = CLASS_COLORS[p.cls];
    ctx.fill();
  });
  // torch flame above
  if (G.torchLit) {
    const ff = 0.75 + 0.25 * Math.sin(t * 0.015);
    ctx.fillStyle = `rgba(255,${150 + 50 * ff},60,0.95)`;
    ctx.beginPath();
    ctx.ellipse(cx, cy - r - 5, 3.5, 6 * ff + 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

// ---------------------------------------------------------------- combat

function combatLayout() {
  const cb = G.combat!;
  const tile = Math.floor(Math.min(W / cb.w, (H - 20) / cb.h));
  return { tile, ox: Math.floor((W - tile * cb.w) / 2), oy: Math.floor((H - tile * cb.h) / 2) };
}

export function pickCombatTile(mx: number, my: number): { x: number; y: number } | null {
  if (!G?.combat) return null;
  const { tile, ox, oy } = combatLayout();
  const x = Math.floor((mx - ox) / tile), y = Math.floor((my - oy) / tile);
  if (x < 0 || y < 0 || x >= G.combat.w || y >= G.combat.h) return null;
  return { x, y };
}

function drawCombat(t: number) {
  const cb = G.combat!;
  const { tile, ox, oy } = combatLayout();
  const th = THEMES[cb.theme] ?? THEMES.cave;
  const f = flicker(t);

  ctx.fillStyle = '#0a0805';
  ctx.fillRect(0, 0, W, H);

  for (let y = 0; y < cb.h; y++) {
    for (let x = 0; x < cb.w; x++) {
      const px = ox + x * tile, py = oy + y * tile;
      if (cb.walls[y * cb.w + x]) {
        ctx.fillStyle = th.wall;
        ctx.fillRect(px, py, tile, tile);
        ctx.fillStyle = th.wallTop;
        ctx.fillRect(px + tile * 0.12, py + tile * 0.1, tile * 0.76, tile * 0.3);
      } else {
        ctx.fillStyle = hash(x, y) > 0.5 ? th.floor : th.floor2;
        ctx.fillRect(px, py, tile, tile);
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 1;
      ctx.strokeRect(px + 0.5, py + 0.5, tile - 1, tile - 1);
    }
  }

  // vignette + central warm light
  const g0 = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.2, W / 2, H / 2, Math.max(W, H) * 0.7);
  g0.addColorStop(0, 'rgba(0,0,0,0)');
  g0.addColorStop(1, 'rgba(0,0,0,0.8)');
  ctx.fillStyle = g0;
  ctx.fillRect(0, 0, W, H);

  const cur = current();

  // movement range for the active PC
  if (cur?.kind === 'pc' && cur.moves > 0) {
    ctx.fillStyle = 'rgba(255,180,90,0.10)';
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = cur.x + dx, ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= cb.w || ny >= cb.h) continue;
      if (blocked(nx, ny)) continue;
      if (cb.order.some(o => o.x === nx && o.y === ny && alive(o))) continue;
      ctx.fillRect(ox + nx * tile, oy + ny * tile, tile, tile);
    }
  }

  // tokens
  for (const c of cb.order) {
    if (!alive(c)) continue;
    const cx = ox + (c.x + 0.5) * tile, cy = oy + (c.y + 0.5) * tile;
    const r = tile * 0.36;

    if (c === cur) {
      ctx.beginPath();
      ctx.arc(cx, cy, r + 5 + 2 * Math.sin(t * 0.008), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,200,110,${0.6 + 0.3 * Math.sin(t * 0.008)})`;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    if (c.kind === 'pc') {
      const pc = c.pc!;
      drawToken(cx, cy, r, CLASS_COLORS[pc.cls], pc.name[0], pc.dyingRounds !== undefined ? '#e06c5a' : '#e6d5ac');
      // HP bar
      const w2 = tile * 0.72;
      const frac = Math.max(0, pc.hp / pc.maxHp);
      ctx.fillStyle = '#0d0a07';
      ctx.fillRect(cx - w2 / 2, cy + r + 3, w2, 4.5);
      ctx.fillStyle = frac > 0.5 ? '#7dc47a' : frac > 0.25 ? '#d8b45a' : '#e06c5a';
      ctx.fillRect(cx - w2 / 2, cy + r + 3, w2 * frac, 4.5);
      if (pc.dyingRounds !== undefined) {
        ctx.fillStyle = '#e06c5a';
        ctx.font = `bold ${tile * 0.3}px Palatino, serif`;
        ctx.fillText(`✝${pc.dyingRounds}`, cx, cy - r - 8);
      }
    } else {
      const m = c.mon!;
      drawToken(cx, cy, r, m.def.color, m.def.glyph.toUpperCase(), m.rooted ? '#c8c2ff' : '#111');
      const maxHp = m.def.hd * 8;
      const frac = Math.max(0.05, Math.min(1, m.hp / Math.max(1, maxHp)));
      const w2 = tile * 0.72;
      ctx.fillStyle = '#0d0a07';
      ctx.fillRect(cx - w2 / 2, cy + r + 3, w2, 4.5);
      ctx.fillStyle = '#b5442d';
      ctx.fillRect(cx - w2 / 2, cy + r + 3, w2 * frac, 4.5);
    }
  }

  // hover crosshair on enemies
  if (hover && cur?.kind === 'pc') {
    const ht = pickCombatTile(hover.x, hover.y);
    if (ht) {
      const target = cb.order.find(o => o.kind === 'monster' && alive(o) && o.x === ht.x && o.y === ht.y);
      if (target) {
        const cx = ox + (ht.x + 0.5) * tile, cy = oy + (ht.y + 0.5) * tile;
        ctx.strokeStyle = '#e06c5a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, tile * 0.46, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
  }

  // round banner (bottom, clear of the HTML banner up top)
  ctx.fillStyle = 'rgba(230,213,172,0.85)';
  ctx.font = '14px Palatino, serif';
  ctx.textAlign = 'center';
  const curName = cur?.kind === 'pc' ? cur.pc!.name : cur?.mon?.def.name ?? '';
  ctx.fillText(`⚔ Round ${cb.round} — ${curName}'s turn`, W / 2, H - 12);
  void f;
}

function alive(c: Combatant): boolean {
  return c.kind === 'pc' ? c.pc!.alive : c.mon!.hp > 0 && !c.mon!.fled && !c.mon!.asleep;
}

// ---------------------------------------------------------------- overworld

export function pickOverworldNode(mx: number, my: number): string | null {
  for (const id of Object.keys(WORLD)) {
    const n = WORLD[id];
    const nx = n.x * W, ny = n.y * H;
    if (Math.hypot(mx - nx, my - ny) < 34) return id;
  }
  return null;
}

function drawOverworld(t: number) {
  // aged parchment
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#d9c69a');
  bg.addColorStop(0.5, '#cdb787');
  bg.addColorStop(1, '#c0a878');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  // stains & speckles
  for (let i = 0; i < 60; i++) {
    const x = hash(i, 7) * W, y = hash(i, 13) * H;
    ctx.fillStyle = `rgba(90,60,30,${0.03 + hash(i, 3) * 0.04})`;
    ctx.beginPath();
    ctx.arc(x, y, 6 + hash(i, 5) * 30, 0, Math.PI * 2);
    ctx.fill();
  }
  // darker, wilder north
  const north = ctx.createLinearGradient(0, 0, 0, H * 0.55);
  north.addColorStop(0, 'rgba(60,42,25,0.28)');
  north.addColorStop(1, 'rgba(60,42,25,0)');
  ctx.fillStyle = north;
  ctx.fillRect(0, 0, W, H * 0.55);

  ctx.strokeStyle = 'rgba(70,48,25,0.5)';
  ctx.lineWidth = 2;
  ctx.setLineDash([7, 6]);
  const drawn = new Set<string>();
  for (const id of Object.keys(WORLD)) {
    const n = WORLD[id];
    for (const l of n.links) {
      const key = [id, l].sort().join('|');
      if (drawn.has(key)) continue;
      drawn.add(key);
      const m = WORLD[l];
      const x1 = n.x * W, y1 = n.y * H, x2 = m.x * W, y2 = m.y * H;
      const mx = (x1 + x2) / 2 + (hash(x1 | 0, y2 | 0) - 0.5) * 60;
      const my = (y1 + y2) / 2 + (hash(y1 | 0, x2 | 0) - 0.5) * 60;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.quadraticCurveTo(mx, my, x2, y2);
      ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  const here = WORLD[G.location];
  for (const id of Object.keys(WORLD)) {
    const n = WORLD[id];
    const x = n.x * W, y = n.y * H;
    const reachable = here.links.includes(id);
    const cleared = n.dungeonId && G.flags[`boss_${n.dungeonId}`];

    if (reachable) {
      ctx.beginPath();
      ctx.arc(x, y, 26 + 3 * Math.sin(t * 0.005), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(180,110,30,${0.5 + 0.25 * Math.sin(t * 0.005)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    drawNodeIcon(n.kind, x, y, id === G.location);

    ctx.fillStyle = '#2b2016';
    ctx.font = 'bold 13px Palatino, serif';
    ctx.textAlign = 'center';
    ctx.fillText(n.name, x, y + 34);
    ctx.font = 'italic 10.5px Palatino, serif';
    ctx.fillStyle = 'rgba(70,48,25,0.8)';
    ctx.fillText(n.kind === 'dungeon' || n.kind === 'cave' ? `danger ${'✦'.repeat(n.tier)}` : n.kind === 'town' ? 'safe haven' : '', x, y + 47);

    if (cleared) {
      ctx.strokeStyle = 'rgba(139,38,53,0.85)';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(x - 14, y - 14); ctx.lineTo(x + 14, y + 14);
      ctx.moveTo(x + 14, y - 14); ctx.lineTo(x - 14, y + 14);
      ctx.stroke();
    }
  }

  // party marker: wax-seal ring at current node
  const px = here.x * W, py = here.y * H;
  ctx.beginPath();
  ctx.arc(px, py - 26, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#8b2635';
  ctx.fill();
  ctx.strokeStyle = '#5d1a24';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#e6d5ac';
  ctx.font = 'bold 10px Palatino, serif';
  ctx.fillText('⚑', px, py - 22);

  // map title
  ctx.fillStyle = 'rgba(43,32,22,0.9)';
  ctx.font = 'italic 20px Palatino, serif';
  ctx.textAlign = 'left';
  ctx.fillText('~ The Ember Marches ~', 20, 34);
}

function drawNodeIcon(kind: string, x: number, y: number, isHere: boolean) {
  ctx.save();
  ctx.translate(x, y);
  switch (kind) {
    case 'town':
      ctx.fillStyle = '#4a3018';
      ctx.fillRect(-13, -4, 26, 14);
      ctx.beginPath();
      ctx.moveTo(-16, -4); ctx.lineTo(0, -18); ctx.lineTo(16, -4);
      ctx.closePath();
      ctx.fillStyle = '#6a4726';
      ctx.fill();
      ctx.fillStyle = isHere ? '#ffb347' : '#8a6234';
      ctx.fillRect(-4, 2, 8, 8);
      break;
    case 'dungeon':
      ctx.beginPath();
      ctx.moveTo(-15, 10); ctx.quadraticCurveTo(-15, -14, 0, -14);
      ctx.quadraticCurveTo(15, -14, 15, 10);
      ctx.closePath();
      ctx.fillStyle = '#3a2c1c';
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-7, 10); ctx.quadraticCurveTo(-7, -4, 0, -4);
      ctx.quadraticCurveTo(7, -4, 7, 10);
      ctx.closePath();
      ctx.fillStyle = '#0d0a06';
      ctx.fill();
      break;
    case 'cave':
      ctx.beginPath();
      ctx.arc(0, 2, 13, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#54432a';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(0, 2, 6.5, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = '#141008';
      ctx.fill();
      break;
    default: // landmark
      ctx.fillStyle = '#5a4326';
      ctx.fillRect(-2.5, -16, 5, 26);
      ctx.fillRect(-11, -14, 18, 4);
      break;
  }
  ctx.restore();
}

// ---------------------------------------------------------------- town

function drawTown(t: number) {
  const f = flicker(t);
  // dusk sky
  const sky = ctx.createLinearGradient(0, 0, 0, H * 0.7);
  sky.addColorStop(0, '#131627');
  sky.addColorStop(0.6, '#2a2338');
  sky.addColorStop(1, '#4a3540');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H * 0.7);
  // moon
  ctx.beginPath();
  ctx.arc(W * 0.78, H * 0.16, 26, 0, Math.PI * 2);
  ctx.fillStyle = '#e8e2cc';
  ctx.fill();
  const mg = ctx.createRadialGradient(W * 0.78, H * 0.16, 26, W * 0.78, H * 0.16, 90);
  mg.addColorStop(0, 'rgba(232,226,204,0.25)');
  mg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = mg;
  ctx.fillRect(W * 0.78 - 90, H * 0.16 - 90, 180, 180);
  // stars
  for (let i = 0; i < 40; i++) {
    const x = hash(i, 21) * W, y = hash(i, 33) * H * 0.5;
    ctx.fillStyle = `rgba(255,255,255,${0.2 + 0.5 * hash(i, 2) * (0.6 + 0.4 * Math.sin(t * 0.002 + i))})`;
    ctx.fillRect(x, y, 1.6, 1.6);
  }
  // ground
  ctx.fillStyle = '#241a14';
  ctx.fillRect(0, H * 0.68, W, H * 0.32);
  ctx.fillStyle = 'rgba(90,70,50,0.2)';
  for (let i = 0; i < 60; i++) {
    ctx.beginPath();
    ctx.ellipse(hash(i, 40) * W, H * (0.72 + hash(i, 41) * 0.24), 14, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // buildings
  const names = ['THE EMBER INN', 'PROVISIONER', 'TEMPLE', 'TAVERN'];
  const n = names.length;
  for (let i = 0; i < n; i++) {
    const bw = W / (n + 1.4);
    const bx = W * 0.06 + i * (bw + W * 0.035);
    const bh = H * (0.26 + hash(i, 50) * 0.1);
    const by = H * 0.7 - bh;
    ctx.fillStyle = i % 2 ? '#2e2119' : '#332419';
    ctx.fillRect(bx, by, bw, bh);
    // roof
    ctx.beginPath();
    ctx.moveTo(bx - 10, by);
    ctx.lineTo(bx + bw / 2, by - H * 0.09);
    ctx.lineTo(bx + bw + 10, by);
    ctx.closePath();
    ctx.fillStyle = '#1c1410';
    ctx.fill();
    // temple gets a spire + symbol
    if (i === 2) {
      ctx.fillStyle = '#1c1410';
      ctx.fillRect(bx + bw / 2 - 5, by - H * 0.16, 10, H * 0.08);
      ctx.fillStyle = '#d8b45a';
      ctx.fillRect(bx + bw / 2 - 1.5, by - H * 0.2, 3, H * 0.045);
      ctx.fillRect(bx + bw / 2 - 6, by - H * 0.187, 12, 3);
    }
    // glowing windows
    const rows = 2, cols = 3;
    for (let r = 0; r < rows; r++) for (let c2 = 0; c2 < cols; c2++) {
      const wx = bx + bw * (0.16 + c2 * 0.3), wy = by + bh * (0.22 + r * 0.4);
      const on = hash(i * 10 + r, c2) > 0.25;
      const gf = on ? 0.75 + 0.25 * Math.sin(t * 0.004 + i * 2 + c2 * 3) : 0;
      if (on) {
        const wg = ctx.createRadialGradient(wx + 6, wy + 8, 2, wx + 6, wy + 8, 26);
        wg.addColorStop(0, `rgba(255,180,90,${0.35 * gf})`);
        wg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = wg;
        ctx.fillRect(wx - 20, wy - 18, 52, 52);
        ctx.fillStyle = `rgba(255,${170 + 30 * gf},${80 + 30 * gf},0.95)`;
      } else {
        ctx.fillStyle = '#171210';
      }
      ctx.fillRect(wx, wy, 12, 16);
      ctx.fillStyle = 'rgba(20,14,10,0.8)';
      ctx.fillRect(wx + 5, wy, 2, 16);
      ctx.fillRect(wx, wy + 7, 12, 2);
    }
    // sign
    ctx.fillStyle = 'rgba(230,213,172,0.9)';
    ctx.font = `bold ${Math.max(9, W * 0.011)}px Palatino, serif`;
    ctx.textAlign = 'center';
    ctx.fillText(names[i], bx + bw / 2, H * 0.7 + 18);
  }

  // street lanterns
  for (const lx of [W * 0.28, W * 0.72]) {
    ctx.fillStyle = '#171210';
    ctx.fillRect(lx - 2, H * 0.52, 4, H * 0.18);
    ctx.fillRect(lx - 10, H * 0.52, 20, 3);
    const lg = ctx.createRadialGradient(lx, H * 0.545, 2, lx, H * 0.545, 70 * f);
    lg.addColorStop(0, 'rgba(255,190,100,0.5)');
    lg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(lx - 70, H * 0.545 - 70, 140, 140);
    ctx.fillStyle = `rgba(255,${180 + 40 * f},90,1)`;
    ctx.fillRect(lx - 4, H * 0.535, 8, 11);
  }

  ctx.fillStyle = 'rgba(230,213,172,0.9)';
  ctx.font = 'italic 20px Palatino, serif';
  ctx.textAlign = 'left';
  ctx.fillText('Emberwick, at lantern-hour', 20, 34);
}
