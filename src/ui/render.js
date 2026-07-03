// Canvas renderer: the god's-eye view of the vale.
//
// Terrain is painted once per sim-day into an offscreen cache with relief
// shading (hillshade from a NW sun) and depth-tinted water. On top of that,
// every frame: shimmering water, drifting cloud shadows, chimney smoke,
// shadowed and bobbing creatures, little lit houses — and a particle system
// that gives each divine act its own spectacle.

import { seasonOf, dayOfYear, BIOME, tileAt } from '../core/world.js';

const TILE_PX = 8;

const BIOME_COLORS = {
  [BIOME.WATER]:    [40, 66, 88],
  [BIOME.PLAINS]:   [126, 138, 74],
  [BIOME.FOREST]:   [62, 94, 54],
  [BIOME.SWAMP]:    [72, 84, 60],
  [BIOME.MOUNTAIN]: [112, 105, 96],
  [BIOME.TUNDRA]:   [150, 150, 140],
};

const SETTLEMENT_HUES = [42, 200, 320, 90, 260, 20, 170, 300, 60, 220];

const hash2 = (x, y) => {
  let h = (x * 73856093) ^ (y * 19349663);
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
};

const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

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

export function settlementColor(s, light = 62) {
  const hue = SETTLEMENT_HUES[s.id % SETTLEMENT_HUES.length];
  return `hsl(${hue}, 55%, ${light}%)`;
}

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
  return { canvas, ctx: canvas.getContext('2d'), paintedDay: -1, lastPaint: 0 };
}

export function paintTerrain(terrain, sim) {
  if (terrain.paintedDay === sim.day) return;
  const now = performance.now();
  if (terrain.paintedDay !== -1 && now - terrain.lastPaint < 120) return;
  terrain.lastPaint = now;
  terrain.paintedDay = sim.day;
  const { ctx } = terrain;
  const world = sim.world;
  const season = seasonOf(sim.day);
  const snow = snowFactor(sim.day);
  const elevAt = (x, y) => {
    const t = tileAt(world, x, y);
    return t ? t.elev : 0.32;
  };

  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const t = world.tiles[y * world.w + x];
      let [r, g, b] = BIOME_COLORS[t.biome];
      const v = hash2(x, y) * 6 - 3;
      r += v * 2; g += v * 2; b += v;

      if (t.biome === BIOME.WATER) {
        // Depth: darker toward the deeps, glassy toward the shore.
        const depth = clamp((0.32 - t.elev) * 5, 0, 1);
        r *= 1 - depth * 0.45; g *= 1 - depth * 0.4; b *= 1 - depth * 0.25;
        const shore =
          elevAt(x - 1, y) >= 0.32 || elevAt(x + 1, y) >= 0.32 ||
          elevAt(x, y - 1) >= 0.32 || elevAt(x, y + 1) >= 0.32;
        if (shore) { r += 26; g += 30; b += 30; }
        if (snow > 0.5) { r = r * 0.5 + 108; g = g * 0.5 + 116; b = b * 0.5 + 126; }
      } else {
        // Relief: a sun in the northwest rakes across the slopes.
        const dzdx = elevAt(x + 1, y) - elevAt(x - 1, y);
        const dzdy = elevAt(x, y + 1) - elevAt(x, y - 1);
        const shade = clamp(1 + (-dzdx - dzdy) * (t.biome === BIOME.MOUNTAIN ? 5.5 : 3.2)
          + (t.elev - 0.5) * 0.18, 0.68, 1.32);
        r *= shade; g *= shade; b *= shade;

        if (season === 'autumn' && (t.biome === BIOME.FOREST || t.biome === BIOME.PLAINS)) {
          r += 24; g -= 4; b -= 6;
        }
        if (snow > 0) {
          const sAmt = snow * 0.65 * clamp(0.6 + t.elev, 0.6, 1.1);
          r = r * (1 - sAmt) + 208 * sAmt; g = g * (1 - sAmt) + 211 * sAmt; b = b * (1 - sAmt) + 218 * sAmt;
        }
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

      // Decoration, lit to match the NW sun: canopy highlights up-left,
      // shadows down-right.
      const h1 = hash2(x * 3 + 1, y * 5 + 2), h2 = hash2(x * 7 + 3, y * 3 + 1);
      if (t.biome === BIOME.FOREST && t.wood > 6) {
        const tx = x * TILE_PX + 1 + h1 * 3, ty = y * TILE_PX + 1 + h2 * 2;
        drawTree(ctx, tx, ty, snow);
        if (h2 > 0.45) drawTree(ctx, x * TILE_PX + 3 + h2 * 2, y * TILE_PX + 3 + h1 * 2, snow);
      } else if (t.biome === BIOME.MOUNTAIN) {
        const mx = x * TILE_PX + 1 + h1 * 3, my = y * TILE_PX + 1 + h2 * 3;
        ctx.fillStyle = 'rgba(60,54,50,0.85)';
        ctx.fillRect(mx + 1, my + 1, 3, 2);
        ctx.fillStyle = snow > 0.3 ? 'rgba(235,238,242,0.95)' : 'rgba(150,144,136,0.95)';
        ctx.fillRect(mx, my, 3, 2);
      } else if (t.biome === BIOME.SWAMP && h1 > 0.6) {
        ctx.fillStyle = 'rgba(44, 66, 52, 0.8)';
        ctx.fillRect(x * TILE_PX + h2 * 6, y * TILE_PX + h1 * 5, 1, 3);
      } else if (t.biome === BIOME.PLAINS && h1 > 0.82 && snow < 0.3) {
        ctx.fillStyle = season === 'autumn' ? 'rgba(190,150,60,0.5)' : 'rgba(160,175,90,0.6)';
        ctx.fillRect(x * TILE_PX + h2 * 6, y * TILE_PX + h1 * 6, 1, 2);
      }
    }
  }
}

function drawTree(ctx, tx, ty, snow) {
  // ground shadow, canopy, sunlit crown
  ctx.fillStyle = 'rgba(20, 30, 18, 0.5)';
  ctx.fillRect(tx + 1, ty + 3, 3, 1);
  ctx.fillStyle = snow > 0.4 ? 'rgba(214,220,226,0.95)' : 'rgba(38, 66, 36, 0.95)';
  ctx.fillRect(tx, ty, 3, 3);
  ctx.fillStyle = snow > 0.4 ? 'rgba(240,244,248,0.95)' : 'rgba(74, 108, 56, 0.95)';
  ctx.fillRect(tx, ty, 2, 1);
}

// ---- effects: particles, rings, bolts, flashes and the shaking earth ----
export function makeEffects() {
  const list = [];       // rings / bolts / shafts / glyphs / scorches
  const parts = [];      // particles
  const api = {
    shake: 0,
    flash: 0,
    add(x, y, color, big = false) { list.push({ type: 'ring', x, y, color, big, t: 1 }); },
    spawn(n, fn) {
      for (let i = 0; i < n && parts.length < 900; i++) parts.push(fn(i));
    },
    // The spectacle of each divine act.
    power(key, x, y) {
      const R = Math.random;
      switch (key) {
        case 'bounty':
          api.spawn(46, () => ({
            x: x + (R() - 0.5) * 7, y: y + (R() - 0.5) * 7,
            vx: (R() - 0.5) * 0.6, vy: -0.8 - R() * 1.4, g: -0.3,
            life: 1.4 + R(), max: 2.4, size: 2 + R() * 2,
            color: R() > 0.4 ? [150, 220, 90] : [240, 210, 110], glow: true,
          }));
          list.push({ type: 'ring', x, y, color: '#a8e070', big: true, t: 1 });
          break;
        case 'blight':
          api.spawn(46, () => ({
            x: x + (R() - 0.5) * 8, y: y + (R() - 0.5) * 8 - 2,
            vx: (R() - 0.5) * 0.5, vy: 0.4 + R() * 0.5, g: 0.15,
            life: 1.6 + R(), max: 2.6, size: 2.5 + R() * 3,
            color: R() > 0.5 ? [80, 40, 100] : [40, 30, 40],
          }));
          list.push({ type: 'ring', x, y, color: '#7a3fa0', big: true, t: 1 });
          break;
        case 'heal':
          list.push({ type: 'shaft', x, y, t: 1 });
          api.spawn(26, () => ({
            x: x + (R() - 0.5) * 2, y: y + (R() - 0.5) * 2,
            vx: (R() - 0.5) * 0.4, vy: -1 - R(), g: -0.2,
            life: 1 + R() * 0.8, max: 1.8, size: 1.5 + R() * 1.5,
            color: [255, 244, 200], glow: true,
          }));
          break;
        case 'inspire':
          list.push({ type: 'shaft', x, y, t: 1 });
          api.spawn(30, (i) => ({
            x, y, spiral: { r: 0.2, a: (i / 30) * Math.PI * 2, cx: x, cy: y },
            vx: 0, vy: -0.8, g: -0.1,
            life: 1.2 + R() * 0.6, max: 1.8, size: 1.5 + R(),
            color: [255, 210, 90], glow: true,
          }));
          break;
        case 'omenPeace':
          list.push({ type: 'glyph', x, y, glyph: '☮', color: '#cfe6ff', t: 1 });
          list.push({ type: 'ring', x, y, color: '#cfe6ff', big: true, t: 1 });
          break;
        case 'omenWar':
          list.push({ type: 'glyph', x, y, glyph: '⚔', color: '#ff6a4a', t: 1 });
          list.push({ type: 'ring', x, y, color: '#ff6a4a', big: true, t: 1 });
          break;
        case 'lightning':
          list.push({ type: 'bolt', x, y, t: 1 });
          list.push({ type: 'scorch', x, y, t: 1 });
          api.flash = 0.7;
          api.shake = Math.max(api.shake, 0.3);
          api.spawn(20, () => ({
            x, y, vx: (R() - 0.5) * 4, vy: -R() * 3, g: 6,
            life: 0.5 + R() * 0.5, max: 1, size: 1.5 + R() * 1.5,
            color: R() > 0.5 ? [255, 220, 120] : [255, 160, 60], glow: true,
          }));
          break;
        case 'beast':
          api.spawn(40, (i) => ({
            x, y, spiral: { r: 0.3, a: (i / 40) * Math.PI * 2, cx: x, cy: y },
            vx: 0, vy: -0.2, g: 0,
            life: 1.2 + R() * 0.8, max: 2, size: 2.5 + R() * 2.5,
            color: [45, 42, 50],
          }));
          list.push({ type: 'ring', x, y, color: '#8a2020', big: true, t: 1 });
          break;
        case 'quake':
          api.shake = 1.5;
          for (let i = 0; i < 3; i++) list.push({ type: 'ring', x, y, color: '#c9a87a', big: true, t: 1 + i * 0.25 });
          api.spawn(44, () => ({
            x: x + (R() - 0.5) * 12, y: y + (R() - 0.5) * 12,
            vx: (R() - 0.5) * 0.8, vy: -1.2 - R() * 1.5, g: 2.4,
            life: 0.9 + R() * 0.7, max: 1.6, size: 2 + R() * 3,
            color: [150, 126, 96],
          }));
          break;
        case 'rain':
          api.flash = 0.15;
          break;
      }
    },
    step(dt) {
      api.shake = Math.max(0, api.shake - dt);
      api.flash = Math.max(0, api.flash - dt * 2.4);
      for (const e of list) {
        e.t -= dt * (e.type === 'bolt' ? 2.2 : e.type === 'scorch' ? 0.07 : e.type === 'glyph' ? 0.45 : e.type === 'shaft' ? 0.8 : 0.5);
      }
      for (let i = list.length - 1; i >= 0; i--) if (list[i].t <= 0) list.splice(i, 1);
      for (const p of parts) {
        if (p.spiral) {
          p.spiral.r += dt * 2.2;
          p.spiral.a += dt * 4;
          p.x = p.spiral.cx + Math.cos(p.spiral.a) * p.spiral.r;
          p.y = p.spiral.cy + Math.sin(p.spiral.a) * p.spiral.r * 0.6;
          p.spiral.cy += p.vy * dt;
        } else {
          p.vy += (p.g ?? 0) * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
        }
        p.life -= dt;
      }
      for (let i = parts.length - 1; i >= 0; i--) if (parts[i].life <= 0) parts.splice(i, 1);
    },
    list,
    parts,
  };
  return api;
}

// ---- weather particles (screen space) ----
const wparticles = [];
function stepWeather(ctx, sim, canvas, dt) {
  const season = seasonOf(sim.day);
  const snowing = season === 'winter';
  const raining = sim.weather.rainDays > 0 || sim.weather.storm;
  const want = sim.weather.storm ? 170 : raining ? 90 : snowing ? 70 : 0;

  while (wparticles.length < want) {
    wparticles.push({ x: Math.random() * canvas.width, y: Math.random() * canvas.height, s: 0.5 + Math.random() });
  }
  if (wparticles.length > want) wparticles.splice(0, wparticles.length - want);
  if (!wparticles.length) return;

  if (raining) {
    ctx.strokeStyle = 'rgba(150, 180, 220, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const p of wparticles) {
      p.y += (500 + p.s * 300) * dt;
      p.x += 120 * dt;
      if (p.y > canvas.height) { p.y = -10; p.x = Math.random() * canvas.width; }
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - 3, p.y - 9);
    }
    ctx.stroke();
  } else {
    ctx.fillStyle = 'rgba(235, 240, 245, 0.6)';
    for (const p of wparticles) {
      p.y += (28 + p.s * 22) * dt;
      p.x += Math.sin(p.y * 0.02 + p.s * 7) * 14 * dt;
      if (p.y > canvas.height) { p.y = -4; p.x = Math.random() * canvas.width; }
      ctx.fillRect(p.x, p.y, 1.6, 1.6);
    }
  }
}

// ---- drifting cloud shadows (world-anchored, endless) ----
const CLOUDS = Array.from({ length: 5 }, (_, i) => ({
  y: 8 + hash2(i, 7) * 60,
  r: 9 + hash2(i, 13) * 12,
  speed: 0.35 + hash2(i, 29) * 0.4,
  phase: hash2(i, 41) * 300,
  squish: 0.55 + hash2(i, 53) * 0.2,
}));

function drawClouds(ctx, sim, cam, time) {
  const span = sim.world.w + 60;
  for (const c of CLOUDS) {
    const wx = ((c.phase + time * c.speed) % span) - 30;
    const wy = c.y + Math.sin(time * 0.05 + c.phase) * 4;
    const [sx, sy] = cam.toScreen(wx, wy);
    const r = c.r * cam.zoom;
    if (sx < -r * 2 || sx > cam.canvas.width + r * 2 || sy < -r || sy > cam.canvas.height + r) continue;
    const grad = ctx.createRadialGradient(sx, sy, r * 0.2, sx, sy, r);
    grad.addColorStop(0, 'rgba(12, 16, 26, 0.13)');
    grad.addColorStop(1, 'rgba(12, 16, 26, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(sx, sy, r, r * c.squish, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function shimmerWater(ctx, sim, cam, time, x0, y0, x1, y1) {
  const z = cam.zoom;
  ctx.strokeStyle = 'rgba(210, 230, 245, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let ty = Math.max(0, y0); ty <= Math.min(sim.world.h - 1, y1); ty++) {
    for (let tx = Math.max(0, x0); tx <= Math.min(sim.world.w - 1, x1); tx++) {
      const h = hash2(tx, ty);
      if (h < 0.75) continue;
      const t = sim.world.tiles[ty * sim.world.w + tx];
      if (t.biome !== BIOME.WATER) continue;
      const tw = Math.sin(time * 1.6 + h * 40 + tx * 0.7);
      if (tw < 0.4) continue;
      const [sx, sy] = cam.toScreen(tx + 0.15 + h * 0.4, ty + 0.3 + hash2(ty, tx) * 0.5);
      ctx.globalAlpha = (tw - 0.4) * 0.6;
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + z * 0.45, sy);
      ctx.stroke();
      ctx.beginPath();
    }
  }
  ctx.globalAlpha = 1;
}

// ---- chimney smoke ----
function emitSmoke(effects, sim, dt) {
  for (const s of sim.settlements.values()) {
    if (s.members.size === 0 || s.stock.wood <= 0) continue;
    const winter = seasonOf(sim.day) === 'winter';
    const rate = (winter ? 1.6 : 0.4) * Math.min(1, s.members.size / 8);
    if (Math.random() < rate * dt) {
      const h = hash2(s.id, (Math.random() * 100) | 0);
      effects.spawn(1, () => ({
        x: s.x + 0.5 + (h - 0.5) * 2.5, y: s.y - 0.2,
        vx: 0.25 + Math.random() * 0.2, vy: -0.5 - Math.random() * 0.3, g: -0.05,
        life: 2.5 + Math.random() * 2, max: 4.5, size: 2 + Math.random() * 2,
        color: [176, 172, 166], smoke: true,
      }));
    }
  }
}

function drawShadow(ctx, sx, sy, r) {
  ctx.fillStyle = 'rgba(10, 12, 8, 0.28)';
  ctx.beginPath();
  ctx.ellipse(sx, sy + r * 0.85, r * 1.15, r * 0.42, 0, 0, Math.PI * 2);
  ctx.fill();
}

// A small house: shadow, dark wall, sunlit gabled roof.
function drawHouse(ctx, sx, sy, s, wallColor, roofLit, roofDark) {
  ctx.fillStyle = 'rgba(10, 12, 8, 0.3)';
  ctx.beginPath();
  ctx.ellipse(sx + s * 0.15, sy + s * 0.32, s * 0.75, s * 0.26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = wallColor;
  ctx.fillRect(sx - s * 0.5, sy - s * 0.15, s, s * 0.45);
  ctx.fillStyle = roofLit;
  ctx.beginPath();
  ctx.moveTo(sx - s * 0.6, sy - s * 0.15);
  ctx.lineTo(sx, sy - s * 0.62);
  ctx.lineTo(sx, sy - s * 0.15);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = roofDark;
  ctx.beginPath();
  ctx.moveTo(sx + s * 0.6, sy - s * 0.15);
  ctx.lineTo(sx, sy - s * 0.62);
  ctx.lineTo(sx, sy - s * 0.15);
  ctx.closePath();
  ctx.fill();
}

function drawSettlement(ctx, sim, s, cam, time) {
  const z = cam.zoom;
  const [sx, sy] = cam.toScreen(s.x + 0.5, s.y + 0.5);
  const dead = s.members.size === 0;
  const rad = Math.max(z * 1.9, 10);

  // Plaza: trodden earth at the heart of the village.
  if (!dead) {
    const grad = ctx.createRadialGradient(sx, sy, 1, sx, sy, rad);
    grad.addColorStop(0, 'rgba(146, 122, 88, 0.4)');
    grad.addColorStop(1, 'rgba(146, 122, 88, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  // Palisade: a ring of posts.
  if (s.buildings.wall > 0) {
    ctx.fillStyle = dead ? '#4a443c' : '#8a7050';
    const posts = 26;
    for (let i = 0; i < posts; i++) {
      const a = (i / posts) * Math.PI * 2;
      const px = sx + Math.cos(a) * (rad + z * 0.5);
      const py = sy + Math.sin(a) * (rad + z * 0.5) * 0.92;
      ctx.fillRect(px - z * 0.08, py - z * 0.3, Math.max(1.2, z * 0.16), Math.max(2.4, z * 0.5));
    }
  }

  // Farms: striped field patches on the village edge.
  const hue = settlementColor(s);
  for (let i = 0; i < Math.min(s.buildings.farm, 4); i++) {
    const a = 0.6 + i * 1.5;
    const fx = sx + Math.cos(a) * rad * 1.35, fy = sy + Math.sin(a) * rad * 1.35 * 0.9;
    const fw = z * 1.5, fh = z * 1.0;
    ctx.fillStyle = dead ? 'rgba(70,66,52,0.6)' : 'rgba(154, 148, 74, 0.85)';
    ctx.fillRect(fx - fw / 2, fy - fh / 2, fw, fh);
    ctx.strokeStyle = 'rgba(96, 92, 46, 0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let row = 1; row < 4; row++) {
      ctx.moveTo(fx - fw / 2, fy - fh / 2 + (fh * row) / 4);
      ctx.lineTo(fx + fw / 2, fy - fh / 2 + (fh * row) / 4);
    }
    ctx.stroke();
  }

  // Houses ring the plaza; the hall and temple stand nearest the center.
  const houseSize = Math.max(5, z * 0.95);
  const wall = dead ? '#3c362e' : '#6b5843';
  const roofLit = dead ? '#4a443c' : '#b09468';
  const roofDark = dead ? '#403a32' : '#7d674a';
  const n = Math.min(s.buildings.shelter, 9);
  for (let i = 0; i < n; i++) {
    const a = (i / 9) * Math.PI * 2 + 0.35 + hash2(s.id, i) * 0.25;
    const d = rad * (0.68 + hash2(i, s.id) * 0.2);
    drawHouse(ctx, sx + Math.cos(a) * d, sy + Math.sin(a) * d * 0.9, houseSize, wall, roofLit, roofDark);
  }
  if (s.buildings.hall) {
    drawHouse(ctx, sx - houseSize * 0.5, sy - houseSize * 0.2, houseSize * 1.5, dead ? '#3c362e' : '#7a5f40', dead ? '#4a443c' : '#d9a441', dead ? '#403a32' : '#9a7430');
  }
  if (s.buildings.temple) {
    const tx = sx + houseSize * 1.1, ty = sy + houseSize * 0.35;
    drawHouse(ctx, tx, ty, houseSize * 1.15, dead ? '#3c362e' : '#b8b2c4', dead ? '#4a443c' : '#e8e2f2', dead ? '#403a32' : '#a49cb8');
    // spire
    ctx.fillStyle = dead ? '#4a443c' : '#e8e2f2';
    ctx.beginPath();
    ctx.moveTo(tx - z * 0.12, ty - houseSize * 0.6);
    ctx.lineTo(tx, ty - houseSize * 1.25);
    ctx.lineTo(tx + z * 0.12, ty - houseSize * 0.6);
    ctx.closePath();
    ctx.fill();
  }

  // Sheep pen: a fenced fold with its little white flock.
  if (s.buildings.pen > 0) {
    const a = 3.6;
    const px = sx + Math.cos(a) * rad * 1.4, py = sy + Math.sin(a) * rad * 1.3;
    const pw = z * 1.7, ph = z * 1.2;
    ctx.strokeStyle = dead ? '#4a443c' : '#8a7050';
    ctx.lineWidth = Math.max(1, z * 0.12);
    ctx.strokeRect(px - pw / 2, py - ph / 2, pw, ph);
    if (!dead) {
      ctx.fillStyle = '#e8e4da';
      const flock = Math.min(s.sheep ?? 0, 6);
      for (let i = 0; i < flock; i++) {
        const ox = (hash2(s.id, i * 3) - 0.5) * (pw - z * 0.4);
        const oy = (hash2(i * 7, s.id) - 0.5) * (ph - z * 0.4);
        const nibble = Math.sin(time * 2.5 + i * 2.1) > 0.7 ? z * 0.05 : 0;
        ctx.beginPath();
        ctx.ellipse(px + ox, py + oy + nibble, Math.max(1.4, z * 0.2), Math.max(1, z * 0.14), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // Dock: planks reaching out over the water.
  if (s.buildings.dock > 0 && s.dockAt) {
    const [dx, dy] = cam.toScreen(s.dockAt.x + 0.5, s.dockAt.y + 0.5);
    const ang = Math.atan2(dy - sy, dx - sx);
    ctx.save();
    ctx.translate(dx - Math.cos(ang) * z * 0.8, dy - Math.sin(ang) * z * 0.8);
    ctx.rotate(ang);
    ctx.fillStyle = dead ? '#4a443c' : '#7d674a';
    ctx.fillRect(-z * 1.2, -z * 0.22, z * 2.2, z * 0.44);
    ctx.restore();
  }

  // Hearthlight: on winter evenings the village glows.
  if (!dead && s.stock.wood > 0 && snowFactor(sim.day) > 0.2) {
    const flick = 0.75 + Math.sin(time * 7 + s.id) * 0.25;
    const grad = ctx.createRadialGradient(sx, sy, 1, sx, sy, rad * 0.8);
    grad.addColorStop(0, `rgba(255, 170, 60, ${0.12 * flick})`);
    grad.addColorStop(1, 'rgba(255, 170, 60, 0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(sx, sy, rad * 0.8, 0, Math.PI * 2);
    ctx.fill();
  }

  if (z >= 6 && !dead) {
    ctx.fillStyle = 'rgba(230, 218, 190, 0.9)';
    ctx.font = `${Math.max(10, z * 1.05)}px Georgia`;
    ctx.textAlign = 'center';
    ctx.fillText(s.name, sx, sy - rad - houseSize * 0.9);
  }
}

function drawPerson(ctx, sim, p, cam, alpha, time) {
  const wx = lerp(p.px, p.x, alpha), wy = lerp(p.py, p.y, alpha);
  const [sx, syBase] = cam.toScreen(wx + 0.5, wy + 0.5);
  const z = cam.zoom;
  if (sx < -12 || syBase < -12 || sx > cam.canvas.width + 12 || syBase > cam.canvas.height + 12) return;
  const s = p.home !== null ? sim.settlements.get(p.home) : null;
  const child = sim.day - p.bornDay < 14 * 96;
  const r = Math.max(1.6, z * (child ? 0.2 : 0.3));
  const moving = p.px !== p.x || p.py !== p.y;
  const bob = moving ? Math.abs(Math.sin(time * 9 + p.id * 1.7)) * r * 0.45 : 0;
  const sy = syBase - bob;

  // Fishers bob on the water in little hulls instead of casting a land shadow.
  const afloat = p.activity === 'fishing';
  if (afloat) {
    const rock = Math.sin(time * 2 + p.id) * r * 0.15;
    ctx.fillStyle = '#6b5230';
    ctx.beginPath();
    ctx.ellipse(sx, syBase + r * 0.5 + rock, r * 1.5, r * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    drawShadow(ctx, sx, syBase, r);
  }
  // Outlaws go hooded and gray; honest folk wear their village's color.
  const bodyColor = p.outlaw ? '#4a443c' : s ? settlementColor(s) : '#cfc4ae';
  const headColor = p.outlaw ? '#5f584e' : s ? settlementColor(s, 76) : '#e8e0cc';
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.ellipse(sx, sy, r * 0.82, r, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = headColor;
  ctx.beginPath();
  ctx.arc(sx, sy - r * 1.05, r * 0.55, 0, Math.PI * 2);
  ctx.fill();
  if (p.sick) {
    ctx.strokeStyle = '#8a2be2';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(sx, sy - r * 0.3, r + 2, 0, Math.PI * 2); ctx.stroke();
  }
}

function drawMonster(ctx, sim, m, cam, alpha, time) {
  const wx = lerp(m.px ?? m.x, m.x, alpha), wy = lerp(m.py ?? m.y, m.y, alpha);
  const [sx, sy] = cam.toScreen(wx + 0.5, wy + 0.5);
  const z = cam.zoom;
  if (sx < -40 || sy < -40 || sx > cam.canvas.width + 40 || sy > cam.canvas.height + 40) return;

  if (m.kind === 'wolfpack') {
    // A loping scatter of wolves, not one blob.
    for (let i = 0; i < 4; i++) {
      const a = hash2(m.id, i) * Math.PI * 2 + time * 0.4;
      const d = (0.5 + hash2(i, m.id) * 0.8) * z;
      const wxp = sx + Math.cos(a) * d, wyp = sy + Math.sin(a) * d * 0.6;
      const lope = Math.abs(Math.sin(time * 8 + i * 2)) * z * 0.1;
      drawShadow(ctx, wxp, wyp, z * 0.22);
      ctx.fillStyle = '#9aa2ad';
      ctx.save();
      ctx.translate(wxp, wyp - lope);
      drawTriangle(ctx, Math.max(2.4, z * 0.34));
      ctx.restore();
    }
  } else if (m.kind === 'troll') {
    const r = Math.max(5, z * 0.85);
    drawShadow(ctx, sx, sy, r * 0.8);
    const sway = Math.sin(time * 2.2 + m.id) * r * 0.08;
    ctx.fillStyle = '#5e4a34';
    ctx.beginPath();
    ctx.ellipse(sx + sway, sy - r * 0.3, r * 0.7, r * 0.9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7d6448';
    ctx.beginPath();
    ctx.arc(sx + sway, sy - r * 1.1, r * 0.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c9b79a'; // tusks catch the light
    ctx.fillRect(sx + sway - r * 0.3, sy - r * 1.05, Math.max(1, r * 0.12), Math.max(2, r * 0.25));
    ctx.fillRect(sx + sway + r * 0.2, sy - r * 1.05, Math.max(1, r * 0.12), Math.max(2, r * 0.25));
  } else {
    // The dragon: body, beating wings, ember glow.
    const r = Math.max(8, z * 1.15);
    const flap = Math.sin(time * 6 + m.id);
    drawShadow(ctx, sx, sy + r * 0.4, r * (1 + Math.abs(flap) * 0.3));
    const glow = ctx.createRadialGradient(sx, sy, 1, sx, sy, r * 2.2);
    glow.addColorStop(0, 'rgba(255, 120, 40, 0.25)');
    glow.addColorStop(1, 'rgba(255, 120, 40, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(sx, sy, r * 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#a02818';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(sx, sy - r * 0.1);
      ctx.lineTo(sx + dir * r * (0.9 + flap * 0.45), sy - r * (0.55 + flap * 0.4));
      ctx.lineTo(sx + dir * r * 0.55, sy + r * 0.15);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = '#c33b2a';
    ctx.beginPath();
    ctx.ellipse(sx, sy, r * 0.32, r * 0.75, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffb14e';
    ctx.beginPath();
    ctx.arc(sx, sy - r * 0.55, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function render(ctx, sim, cam, selection, effects, hoverTile, alphaT, terrain, time) {
  const { canvas } = cam;
  const z = cam.zoom;
  ctx.fillStyle = '#0c0b09';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.save();
  if (effects.shake > 0) {
    const s = Math.min(1, effects.shake) * 7;
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  paintTerrain(terrain, sim);
  ctx.imageSmoothingEnabled = z >= TILE_PX * 0.9;
  const [ox, oy] = cam.toScreen(0, 0);
  ctx.drawImage(terrain.canvas, ox, oy, sim.world.w * z, sim.world.h * z);

  const [x0, y0] = cam.toWorld(0, 0);
  const [x1, y1] = cam.toWorld(canvas.width, canvas.height);
  shimmerWater(ctx, sim, cam, time, x0, y0, x1 + 1, y1 + 1);

  // Scorch marks lie on the land itself.
  for (const e of effects.list) {
    if (e.type !== 'scorch') continue;
    const [sx, sy] = cam.toScreen(e.x + 0.5, e.y + 0.5);
    ctx.fillStyle = `rgba(18, 12, 8, ${0.5 * Math.min(1, e.t)})`;
    ctx.beginPath();
    ctx.ellipse(sx, sy, z * 1.1, z * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  emitSmoke(effects, sim, render._dt || 0.016);

  for (const s of sim.settlements.values()) {
    if (s.members.size === 0 && sim.day - s.foundedDay > 500) continue;
    const [sx, sy] = cam.toScreen(s.x + 0.5, s.y + 0.5);
    if (sx < -80 || sy < -80 || sx > canvas.width + 80 || sy > canvas.height + 80) continue;
    drawSettlement(ctx, sim, s, cam, time);
  }

  // Deer herds: small tan bodies that nose along the ground.
  for (const h of sim.herds.values()) {
    const hx = lerp(h.px, h.x, alphaT), hy = lerp(h.py, h.y, alphaT);
    const [sx, sy] = cam.toScreen(hx + 0.5, hy + 0.5);
    if (sx < -20 || sy < -20 || sx > canvas.width + 20 || sy > canvas.height + 20) continue;
    const n = Math.min(5, Math.ceil(h.size / 3));
    for (let i = 0; i < n; i++) {
      const a = hash2(h.id * 13 + i, i * 7) * Math.PI * 2;
      const d = (0.4 + hash2(i, h.id) * 0.9) * z;
      const dx = sx + Math.cos(a) * d, dy = sy + Math.sin(a) * d * 0.7;
      const graze = Math.sin(time * 3 + i * 2.4 + h.id) > 0.6 ? z * 0.06 : 0;
      drawShadow(ctx, dx, dy, Math.max(1.5, z * 0.2));
      ctx.fillStyle = '#b9986a';
      ctx.beginPath();
      ctx.ellipse(dx, dy - z * 0.1 + graze, Math.max(1.6, z * 0.26), Math.max(1.2, z * 0.17), 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#a3835a';
      ctx.beginPath();
      ctx.arc(dx + Math.max(1, z * 0.2), dy - z * 0.18 + graze * 1.6, Math.max(0.9, z * 0.1), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  for (const p of sim.folk.values()) {
    if (p.alive) drawPerson(ctx, sim, p, cam, alphaT, time);
  }
  for (const m of sim.monsters.values()) {
    drawMonster(ctx, sim, m, cam, alphaT, time);
  }

  // Selection ring
  if (selection?.kind === 'person' || selection?.kind === 'monster') {
    const e = selection.ref;
    const stillHere = selection.kind === 'person' ? e.alive : sim.monsters.has(e.id);
    if (stillHere) {
      const wx = lerp(e.px ?? e.x, e.x, alphaT), wy = lerp(e.py ?? e.y, e.y, alphaT);
      const [sx, sy] = cam.toScreen(wx + 0.5, wy + 0.5);
      const pulse = 1 + Math.sin(time * 4) * 0.12;
      ctx.strokeStyle = '#f0d78c';
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(sx, sy, Math.max(6, cam.zoom * 0.7) * pulse, 0, Math.PI * 2); ctx.stroke();
    }
  } else if (selection?.kind === 'settlement') {
    const s = selection.ref;
    const [sx, sy] = cam.toScreen(s.x + 0.5, s.y + 0.5);
    ctx.strokeStyle = '#f0d78c';
    ctx.setLineDash([4, 3]);
    ctx.lineDashOffset = -time * 12;
    ctx.beginPath(); ctx.arc(sx, sy, Math.max(cam.zoom * 2.6, 14), 0, Math.PI * 2); ctx.stroke();
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

  // Particles (world-space)
  for (const p of effects.parts) {
    const [sx, sy] = cam.toScreen(p.x + 0.5, p.y + 0.5);
    const a = clamp(p.life / p.max, 0, 1);
    const size = p.size * (z / 9) * (p.smoke ? (2 - a) : 1);
    if (p.glow) ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(${p.color[0]}, ${p.color[1]}, ${p.color[2]}, ${a * (p.smoke ? 0.3 : 0.85)})`;
    ctx.beginPath();
    ctx.arc(sx, sy, Math.max(0.8, size), 0, Math.PI * 2);
    ctx.fill();
    ctx.globalCompositeOperation = 'source-over';
  }

  // Rings, bolts, shafts, glyphs
  for (const e of effects.list) {
    const [sx, sy] = cam.toScreen(e.x + 0.5, e.y + 0.5);
    if (e.type === 'bolt') {
      drawBolt(ctx, sx, sy, e.t, time);
    } else if (e.type === 'shaft') {
      const w = z * (0.8 + (1 - e.t) * 0.4);
      const grad = ctx.createLinearGradient(sx, 0, sx, sy);
      grad.addColorStop(0, `rgba(255, 248, 214, 0)`);
      grad.addColorStop(0.7, `rgba(255, 248, 214, ${0.35 * e.t})`);
      grad.addColorStop(1, `rgba(255, 248, 214, ${0.55 * e.t})`);
      ctx.fillStyle = grad;
      ctx.fillRect(sx - w / 2, 0, w, sy);
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255, 248, 214, ${0.4 * e.t})`;
      ctx.beginPath();
      ctx.ellipse(sx, sy, w, w * 0.4, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'source-over';
    } else if (e.type === 'glyph') {
      ctx.font = `${z * 2.4}px Georgia`;
      ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, e.t) * 0.9;
      ctx.fillStyle = e.color;
      ctx.fillText(e.glyph, sx, sy - (1 - e.t) * z * 2.5);
      ctx.globalAlpha = 1;
    } else if (e.type === 'ring') {
      const t = Math.min(1, e.t);
      ctx.strokeStyle = e.color;
      ctx.globalAlpha = Math.max(0, t);
      ctx.lineWidth = e.big ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.arc(sx, sy, (1 - t) * (e.big ? 52 : 24) + 4, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  drawClouds(ctx, sim, cam, time);
  ctx.restore();

  // Weather veils and particles
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
  stepWeather(ctx, sim, canvas, render._dt || 0.016);

  // Divine flash
  if (effects.flash > 0) {
    ctx.fillStyle = `rgba(255, 252, 235, ${Math.min(0.85, effects.flash)})`;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  // Vignette: the edges of a god's attention fade to dusk.
  const vg = ctx.createRadialGradient(
    canvas.width / 2, canvas.height / 2, Math.min(canvas.width, canvas.height) * 0.45,
    canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.75);
  vg.addColorStop(0, 'rgba(8, 7, 5, 0)');
  vg.addColorStop(1, 'rgba(8, 7, 5, 0.34)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function drawBolt(ctx, sx, sy, t, time) {
  const flicker = Math.floor(time * 24);
  ctx.globalCompositeOperation = 'lighter';
  for (const [width, color] of [[5, `rgba(180, 200, 255, ${t * 0.35})`], [2.2, `rgba(255, 252, 230, ${t})`]]) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    let bx = sx, by = 0;
    ctx.moveTo(bx, by);
    const segs = 8;
    const pts = [];
    for (let i = 1; i <= segs; i++) {
      by = (sy / segs) * i;
      bx = sx + (i === segs ? 0 : (hash2(i * 31, flicker) - 0.5) * 46);
      pts.push([bx, by]);
      ctx.lineTo(bx, by);
    }
    ctx.stroke();
    // Branches fork from the trunk.
    for (const bi of [2, 4]) {
      const [px, py] = pts[bi];
      ctx.beginPath();
      ctx.moveTo(px, py);
      const dir = hash2(bi, flicker) > 0.5 ? 1 : -1;
      ctx.lineTo(px + dir * 18 + (hash2(bi * 7, flicker) - 0.5) * 10, py + 22);
      ctx.lineTo(px + dir * 30 + (hash2(bi * 13, flicker) - 0.5) * 14, py + 48);
      ctx.stroke();
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = `rgba(255, 250, 210, ${t * 0.5})`;
  ctx.beginPath(); ctx.arc(sx, sy, 16 * (1 - t) + 4, 0, Math.PI * 2); ctx.fill();
}

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
