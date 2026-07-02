// Canvas renderer: the god's-eye view of the vale.
// Terrain is painted once per sim-day into an offscreen cache; entities are
// drawn every frame, interpolated between their last two daily positions.

import { seasonOf, dayOfYear, BIOME } from '../core/world.js';

const TILE_PX = 8;

const BIOME_COLORS = {
  [BIOME.WATER]:    [38, 62, 82],
  [BIOME.PLAINS]:   [126, 138, 74],
  [BIOME.FOREST]:   [62, 94, 54],
  [BIOME.SWAMP]:    [72, 84, 60],
  [BIOME.MOUNTAIN]: [110, 102, 94],
  [BIOME.TUNDRA]:   [150, 150, 140],
};

const SETTLEMENT_HUES = [42, 200, 320, 90, 260, 20, 170, 300, 60, 220];

const hash2 = (x, y) => {
  let h = (x * 73856093) ^ (y * 19349663);
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
};

export function makeCamera(canvas, worldW, worldH) {
  return {
    x: worldW / 2, y: worldH / 2,
    zoom: 9,
    canvas,
    toScreen(wx, wy) {
      return [
        (wx - this.x) * this.zoom + this.canvas.width / 2,
        (wy - this.y) * this.zoom + this.canvas.height / 2,
      ];
    },
    toWorld(sx, sy) {
      return [
        Math.floor((sx - this.canvas.width / 2) / this.zoom + this.x),
        Math.floor((sy - this.canvas.height / 2) / this.zoom + this.y),
      ];
    },
  };
}

export function settlementColor(s) {
  const hue = SETTLEMENT_HUES[s.id % SETTLEMENT_HUES.length];
  return `hsl(${hue}, 55%, 62%)`;
}

// How deep the snow lies, 0..1: builds through early winter, melts in spring.
function snowFactor(day) {
  const doy = dayOfYear(day);
  const season = seasonOf(day);
  if (season === 'winter') return Math.min(1, (doy - 72) / 8);
  if (season === 'spring') return Math.max(0, 1 - doy / 8);
  return 0;
}

// ---- terrain cache: repainted when the sim day changes ----
export function makeTerrain(world) {
  const canvas = document.createElement('canvas');
  canvas.width = world.w * TILE_PX;
  canvas.height = world.h * TILE_PX;
  return { canvas, ctx: canvas.getContext('2d'), paintedDay: -1 };
}

export function paintTerrain(terrain, sim) {
  if (terrain.paintedDay === sim.day) return;
  // At high sim speeds, repainting every day would swamp the frame budget;
  // terrain changes slowly enough that ~8 repaints a second reads as live.
  const now = performance.now();
  if (terrain.paintedDay !== -1 && now - (terrain.lastPaint || 0) < 120) return;
  terrain.lastPaint = now;
  terrain.paintedDay = sim.day;
  const { ctx } = terrain;
  const world = sim.world;
  const season = seasonOf(sim.day);
  const snow = snowFactor(sim.day);

  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const t = world.tiles[y * world.w + x];
      let [r, g, b] = BIOME_COLORS[t.biome];
      const v = hash2(x, y) * 6 - 3;
      r += v * 2; g += v * 2; b += v;

      if (t.biome === BIOME.WATER) {
        // Shallows glow lighter along the shore; deep winter skins them with ice.
        const shore =
          (x > 0 && world.tiles[y * world.w + x - 1].biome !== BIOME.WATER) ||
          (x < world.w - 1 && world.tiles[y * world.w + x + 1].biome !== BIOME.WATER) ||
          (y > 0 && world.tiles[(y - 1) * world.w + x].biome !== BIOME.WATER) ||
          (y < world.h - 1 && world.tiles[(y + 1) * world.w + x].biome !== BIOME.WATER);
        if (shore) { r += 18; g += 22; b += 24; }
        if (snow > 0.5) { r = r * 0.5 + 105; g = g * 0.5 + 115; b = b * 0.5 + 125; }
      } else {
        if (season === 'autumn') {
          if (t.biome === BIOME.FOREST || t.biome === BIOME.PLAINS) { r += 24; g -= 4; b -= 6; }
        }
        if (snow > 0) { r = r * (1 - snow * 0.65) + 205 * snow * 0.65; g = g * (1 - snow * 0.65) + 208 * snow * 0.65; b = b * (1 - snow * 0.65) + 215 * snow * 0.65; }
        if (t.blight > 0.05) { r = r * (1 - t.blight * 0.5) + 58 * t.blight; g *= 1 - t.blight * 0.55; b *= 1 - t.blight * 0.35; }
        if (t.bounty > 0.05) { g += t.bounty * 34; r += t.bounty * 8; }
      }
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);

      // Worn footpaths: the folk's comings and goings, made visible.
      if (t.traffic > 4 && t.biome !== BIOME.WATER) {
        const wear = Math.min(1, (t.traffic - 4) / 20);
        ctx.fillStyle = `rgba(146, 122, 88, ${wear * 0.75})`;
        ctx.fillRect(x * TILE_PX + 2, y * TILE_PX + 2, TILE_PX - 4, TILE_PX - 4);
      }

      // Decoration: trees, crags, reeds — hashed so they never flicker.
      const h1 = hash2(x * 3 + 1, y * 5 + 2), h2 = hash2(x * 7 + 3, y * 3 + 1);
      if (t.biome === BIOME.FOREST && t.wood > 6) {
        ctx.fillStyle = snow > 0.4 ? 'rgba(220,225,230,0.9)' : 'rgba(36, 62, 34, 0.9)';
        ctx.fillRect(x * TILE_PX + 1 + h1 * 4, y * TILE_PX + 1 + h2 * 3, 2, 3);
        if (h2 > 0.5) ctx.fillRect(x * TILE_PX + 4 + h2 * 2, y * TILE_PX + 3 + h1 * 2, 2, 3);
      } else if (t.biome === BIOME.MOUNTAIN) {
        ctx.fillStyle = h1 > 0.5 ? 'rgba(140,134,126,0.9)' : 'rgba(84,78,72,0.9)';
        ctx.fillRect(x * TILE_PX + 1 + h1 * 4, y * TILE_PX + 1 + h2 * 4, 3, 2);
      } else if (t.biome === BIOME.SWAMP && h1 > 0.6) {
        ctx.fillStyle = 'rgba(44, 66, 52, 0.8)';
        ctx.fillRect(x * TILE_PX + h2 * 6, y * TILE_PX + h1 * 5, 1, 3);
      }
    }
  }
}

// ---- transient effects: rings, bolts, and the shaking earth ----
export function makeEffects() {
  const list = [];
  const api = {
    shake: 0,
    add(x, y, color, big = false) { list.push({ type: 'ring', x, y, color, big, t: 1 }); },
    bolt(x, y) { list.push({ type: 'bolt', x, y, t: 1 }); },
    step(dt) {
      api.shake = Math.max(0, api.shake - dt);
      for (const e of list) e.t -= dt * (e.type === 'bolt' ? 2.2 : 0.5);
      for (let i = list.length - 1; i >= 0; i--) if (list[i].t <= 0) list.splice(i, 1);
    },
    list,
  };
  return api;
}

// ---- weather particles (screen space) ----
const particles = [];
function stepParticles(ctx, sim, canvas, dt) {
  const season = seasonOf(sim.day);
  const snowing = season === 'winter';
  const raining = sim.weather.rainDays > 0 || sim.weather.storm;
  const want = sim.weather.storm ? 170 : raining ? 90 : snowing ? 70 : 0;

  while (particles.length < want) {
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      s: 0.5 + Math.random(),
    });
  }
  if (particles.length > want) particles.splice(0, particles.length - want);
  if (!particles.length) return;

  if (raining) {
    ctx.strokeStyle = 'rgba(150, 180, 220, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of particles) {
      p.y += (500 + p.s * 300) * dt;
      p.x += 120 * dt;
      if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 3, p.y - 9);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(235, 240, 245, 0.6)';
    for (const p of particles) {
      p.y += (28 + p.s * 22) * dt;
      p.x += Math.sin(p.y * 0.02 + p.s * 7) * 14 * dt;
      if (p.y > canvas.height) { p.y = -4; p.x = Math.random() * canvas.width; }
      ctx.fillRect(p.x, p.y, 1.6, 1.6);
    }
  }
}

const lerp = (a, b, t) => a + (b - a) * t;

export function render(ctx, sim, cam, selection, effects, hoverTile, alpha, terrain) {
  const { canvas } = cam;
  const z = cam.zoom;
  ctx.fillStyle = '#0c0b09';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  if (effects.shake > 0) {
    const s = Math.min(1, effects.shake) * 7;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  // Terrain from the cache, scaled to the camera.
  paintTerrain(terrain, sim);
  ctx.imageSmoothingEnabled = z >= TILE_PX * 0.9;
  const [ox, oy] = cam.toScreen(0, 0);
  ctx.drawImage(terrain.canvas, ox, oy, sim.world.w * z, sim.world.h * z);

  // Settlements
  for (const s of sim.settlements.values()) {
    if (s.members.size === 0 && sim.day - s.foundedDay > 500) continue;
    const [sx, sy] = cam.toScreen(s.x + 0.5, s.y + 0.5);
    if (sx < -60 || sy < -60 || sx > canvas.width + 60 || sy > canvas.height + 60) continue;
    const col = settlementColor(s);
    const dead = s.members.size === 0;
    ctx.strokeStyle = dead ? '#555' : col;
    ctx.lineWidth = 1.5;
    const rad = Math.max(z * 1.6, 8);
    ctx.beginPath();
    ctx.arc(sx, sy, rad, 0, Math.PI * 2);
    ctx.stroke();
    if (s.buildings.wall > 0) {
      ctx.strokeStyle = dead ? '#444' : '#c9b79a';
      ctx.beginPath();
      ctx.arc(sx, sy, rad + 2.5, 0, Math.PI * 2);
      ctx.stroke();
    }
    const bs = [];
    for (let i = 0; i < s.buildings.shelter; i++) bs.push('#a89170');
    for (let i = 0; i < s.buildings.farm; i++) bs.push('#c9c25c');
    if (s.buildings.hall) bs.push('#d9a441');
    if (s.buildings.temple) bs.push('#e6e0ff');
    bs.slice(0, 10).forEach((c, i) => {
      const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.fillStyle = dead ? '#3c362e' : c;
      const bx = sx + Math.cos(a) * rad * 0.62, by = sy + Math.sin(a) * rad * 0.62;
      ctx.fillRect(bx - z * 0.22, by - z * 0.22, z * 0.44, z * 0.44);
    });
    if (z >= 6 && !dead) {
      ctx.fillStyle = 'rgba(230, 218, 190, 0.85)';
      ctx.font = `${Math.max(10, z * 1.1)}px Georgia`;
      ctx.textAlign = 'center';
      ctx.fillText(s.name, sx, sy - rad - 4);
    }
  }

  // Deer herds: a scatter of small tan shapes.
  for (const h of sim.herds.values()) {
    const hx = lerp(h.px, h.x, alpha), hy = lerp(h.py, h.y, alpha);
    const [sx, sy] = cam.toScreen(hx + 0.5, hy + 0.5);
    if (sx < -20 || sy < -20 || sx > canvas.width + 20 || sy > canvas.height + 20) continue;
    ctx.fillStyle = '#b9986a';
    const n = Math.min(5, Math.ceil(h.size / 3));
    for (let i = 0; i < n; i++) {
      const a = hash2(h.id * 13 + i, i * 7) * Math.PI * 2;
      const d = (0.4 + hash2(i, h.id) * 0.9) * z;
      ctx.fillRect(sx + Math.cos(a) * d, sy + Math.sin(a) * d, Math.max(1.5, z * 0.22), Math.max(1.5, z * 0.18));
    }
  }

  // Folk, gliding between yesterday and today.
  for (const p of sim.folk.values()) {
    if (!p.alive) continue;
    const wx = lerp(p.px, p.x, alpha), wy = lerp(p.py, p.y, alpha);
    const [sx, sy] = cam.toScreen(wx + 0.5, wy + 0.5);
    if (sx < -10 || sy < -10 || sx > canvas.width + 10 || sy > canvas.height + 10) continue;
    const s = p.home !== null ? sim.settlements.get(p.home) : null;
    const child = sim.day - p.bornDay < 14 * 96;
    ctx.fillStyle = s ? settlementColor(s) : '#cfc4ae';
    const r = Math.max(1.4, z * (child ? 0.18 : 0.28));
    ctx.beginPath();
    ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fill();
    if (p.sick) {
      ctx.strokeStyle = '#8a2be2';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(sx, sy, r + 1.5, 0, Math.PI * 2); ctx.stroke();
    }
  }

  // Monsters
  for (const m of sim.monsters.values()) {
    const wx = lerp(m.px ?? m.x, m.x, alpha), wy = lerp(m.py ?? m.y, m.y, alpha);
    const [sx, sy] = cam.toScreen(wx + 0.5, wy + 0.5);
    ctx.save();
    ctx.translate(sx, sy);
    if (m.kind === 'wolfpack') {
      ctx.fillStyle = '#9aa2ad';
      drawTriangle(ctx, Math.max(3, z * 0.5));
    } else if (m.kind === 'troll') {
      ctx.fillStyle = '#7d6448';
      drawTriangle(ctx, Math.max(5, z * 0.8));
    } else {
      ctx.fillStyle = '#c33b2a';
      drawTriangle(ctx, Math.max(7, z * 1.1));
      ctx.strokeStyle = '#ffb14e';
      ctx.lineWidth = 1.5;
      drawTriangle(ctx, Math.max(7, z * 1.1), true);
    }
    ctx.restore();
  }

  // Selection ring
  if (selection?.kind === 'person' || selection?.kind === 'monster') {
    const e = selection.ref;
    const stillHere = selection.kind === 'person' ? e.alive : sim.monsters.has(e.id);
    if (stillHere) {
      const wx = lerp(e.px ?? e.x, e.x, alpha), wy = lerp(e.py ?? e.y, e.y, alpha);
      const [sx, sy] = cam.toScreen(wx + 0.5, wy + 0.5);
      ctx.strokeStyle = '#f0d78c';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(6, cam.zoom * 0.7), 0, Math.PI * 2); ctx.stroke();
    }
  } else if (selection?.kind === 'settlement') {
    const s = selection.ref;
    const [sx, sy] = cam.toScreen(s.x + 0.5, s.y + 0.5);
    ctx.strokeStyle = '#f0d78c';
    ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(cam.zoom * 2.2, 12), 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  } else if (selection?.kind === 'herd' && sim.herds.has(selection.ref.id)) {
    const h = selection.ref;
    const [sx, sy] = cam.toScreen(h.x + 0.5, h.y + 0.5);
    ctx.strokeStyle = '#f0d78c';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(8, cam.zoom), 0, Math.PI * 2); ctx.stroke();
  }

  if (hoverTile) {
    const [sx, sy] = cam.toScreen(hoverTile[0], hoverTile[1]);
    ctx.strokeStyle = 'rgba(240, 215, 140, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, sy, z, z);
  }

  // Effects: rings and bolts.
  for (const e of effects.list) {
    const [sx, sy] = cam.toScreen(e.x + 0.5, e.y + 0.5);
    if (e.type === 'bolt') {
      ctx.strokeStyle = `rgba(255, 250, 210, ${Math.max(0, e.t)})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      let bx = sx, by = 0;
      ctx.moveTo(bx, by);
      const segs = 7;
      for (let i = 1; i <= segs; i++) {
        by = (sy / segs) * i;
        bx = sx + (i === segs ? 0 : (hash2(i * 31, Math.floor(e.t * 20)) - 0.5) * 40);
        ctx.lineTo(bx, by);
      }
      ctx.stroke();
      ctx.fillStyle = `rgba(255, 250, 210, ${Math.max(0, e.t) * 0.5})`;
      ctx.beginPath(); ctx.arc(sx, sy, 14 * (1 - e.t) + 4, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = Math.max(0, e.t);
      ctx.lineWidth = e.big ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, (1 - e.t) * (e.big ? 46 : 22) + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();

  // Weather: veil plus particles.
  if (sim.weather.storm) {
    ctx.fillStyle = 'rgba(40, 45, 70, 0.28)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (sim.weather.rainDays > 0) {
    ctx.fillStyle = 'rgba(60, 80, 110, 0.12)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (sim.weather.drought) {
    ctx.fillStyle = 'rgba(150, 110, 30, 0.10)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  stepParticles(ctx, sim, canvas, Math.min(0.05, render._dt || 0.016));
}

// The frame delta is fed in by the main loop for particle motion.
export function setRenderDt(dt) { render._dt = dt; }

export function renderMinimap(mctx, sim, cam, terrain) {
  const mw = mctx.canvas.width, mh = mctx.canvas.height;
  mctx.imageSmoothingEnabled = true;
  mctx.drawImage(terrain.canvas, 0, 0, mw, mh);
  const fx = mw / sim.world.w, fy = mh / sim.world.h;
  for (const s of sim.settlements.values()) {
    if (s.members.size === 0) continue;
    mctx.fillStyle = settlementColor(s);
    mctx.fillRect(s.x * fx - 1.5, s.y * fy - 1.5, 3, 3);
  }
  for (const m of sim.monsters.values()) {
    mctx.fillStyle = m.kind === 'dragon' ? '#ff3b1a' : '#d8828a';
    mctx.fillRect(m.x * fx - 1, m.y * fy - 1, 2, 2);
  }
  // Viewport rectangle
  const [wx0, wy0] = cam.toWorld(0, 0);
  const [wx1, wy1] = cam.toWorld(cam.canvas.width, cam.canvas.height);
  mctx.strokeStyle = 'rgba(240, 215, 140, 0.8)';
  mctx.lineWidth = 1;
  mctx.strokeRect(wx0 * fx, wy0 * fy, (wx1 - wx0) * fx, (wy1 - wy0) * fy);
}

function drawTriangle(ctx, r, strokeOnly = false) {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.87, r * 0.6);
  ctx.lineTo(-r * 0.87, r * 0.6);
  ctx.closePath();
  if (strokeOnly) ctx.stroke(); else ctx.fill();
}
