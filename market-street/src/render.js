// Isometric city renderer: roads, districts, buildings, river, day/night,
// ambient traffic and shoppers — plus stores, warehouse, trucks, rivals.

import {
  TILE_W, TILE_H, GRID, isRoad, WAREHOUSE, PRODUCTS, DISTRICTS,
  SHELF_CAP, RIVAL,
} from './defs.js';

const PROD_IDS = Object.keys(PRODUCTS);
const ROAD_LINES = [0, 4, 8, 12, 16, 20];
const CAR_COLORS = ['#c8cdd6', '#8fa8c8', '#c8a08a', '#9ec09a', '#b0a0c8', '#d6c08a'];
const WALKER_COLORS = ['#e8d8c0', '#c0d8e8', '#e8c0c8', '#c8e8c0', '#d8c8e8'];
const HOUSE_TONES = [
  ['#8a93a3', '#5f6675', '#747d8c'],   // slate
  ['#a3907a', '#6f6252', '#8b7b66'],   // tan
  ['#93a08e', '#616c5e', '#7b8877'],   // sage
  ['#a08a95', '#6d5c65', '#87737d'],   // mauve
  ['#9aa3b8', '#6a7385', '#828da2'],   // powder blue
  ['#b0a08a', '#7a6d5a', '#958772'],   // cream
];
const ROOF_TONES = ['#8a5844', '#5d6470', '#726055', '#4f5e6e', '#7d6a4f'];

// Smooth two-octave value noise built on the tile hash (for terrain).
function vnoise(x, y) {
  const s = (a, b) => hash(Math.floor(a) & 1023, Math.floor(b) & 1023);
  const fx = x - Math.floor(x), fy = y - Math.floor(y);
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  const n = (xx, yy) =>
    s(xx, yy) * (1 - u) * (1 - v) + s(xx + 1, yy) * u * (1 - v)
    + s(xx, yy + 1) * (1 - u) * v + s(xx + 1, yy + 1) * u * v;
  return n(x, y) * 0.65 + n(x * 2.3 + 40, y * 2.3 + 40) * 0.35;
}

// Deterministic per-tile hash for decorative variety.
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

// The river runs down Riverside's western edge; road rows cross it as bridges.
function isRiver(x, y) {
  return x === 1 && y >= 13;
}

// Small public parks scattered across the city (lot tiles, never sites).
const PARKS = [[9, 6], [18, 2], [5, 21], [21, 14]];

// One signature landmark per district.
const LANDMARKS = [
  { x: 7, y: 2, kind: 'clocktower' },    // Old Town
  { x: 15, y: 6, kind: 'watertower' },   // Westside
  { x: 2, y: 17, kind: 'pier' },         // Riverside (reaches over the river)
  { x: 17, y: 17, kind: 'glasstower' },  // Downtown
  { x: 22, y: 18, kind: 'glasstower2' }, // Downtown
];
function landmarkAt(x, y) {
  return LANDMARKS.find((l) => l.x === x && l.y === y);
}
function isPark(x, y) {
  return PARKS.some(([px, py]) => px === x && py === y);
}

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.cars = [];
    this.walkers = [];
    this.carClock = 0;
    this.walkerClock = 0;
    this.lastReal = performance.now();
    this.clouds = Array.from({ length: 4 }, () => ({
      x: Math.random(), y: 0.12 + Math.random() * 0.55,
      s: 0.6 + Math.random() * 0.7, v: 0.008 + Math.random() * 0.010,
    }));
    this.boat = { t: Math.random(), dir: 1 };
    this.puffs = [];
    this.birds = [];
    this.birdClock = 0;
    this.stars = Array.from({ length: 110 }, (_, i) => ({
      x: hash(i, 7), y: hash(i, 13) * 0.55, tw: hash(i, 29) * 6,
    }));
    this.weather = null;          // { type: 'rain'|'snow', ttl }
    this.weatherClock = 0;
    this.drops = [];
    this.motes = [];              // petals / leaves / fireflies
    this.moteClock = 0;
    this.lightning = null;        // { t, x } while a bolt flashes
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = rect.width;
    this.h = rect.height;
    const mapW = GRID * TILE_W + 40;
    const mapH = GRID * TILE_H + 120;
    this.baseScale = Math.min(1, this.w / mapW, this.h / mapH);
    this.zoom ??= 1;
    this.panX ??= 0;
    this.panY ??= 0;
    this.applyView();
  }

  applyView() {
    this.scale = this.baseScale * this.zoom;
    this.tw = TILE_W * this.scale;
    this.th = TILE_H * this.scale;
    this.panX = Math.max(-GRID * this.tw * 0.6, Math.min(GRID * this.tw * 0.6, this.panX));
    this.panY = Math.max(-GRID * this.th * 0.9, Math.min(GRID * this.th * 0.9, this.panY));
    this.originX = this.w / 2 + this.panX;
    this.originY = (this.h - GRID * this.th) / 2 + this.th + this.panY;
  }

  // Zoom toward a screen anchor so the point under the cursor stays put.
  setZoom(nz, ax = this.w / 2, ay = this.h / 2) {
    nz = Math.max(0.55, Math.min(2.6, nz));
    const ratio = (this.baseScale * nz) / this.scale;
    const nOx = ax - (ax - this.originX) * ratio;
    const nOy = ay - (ay - this.originY) * ratio;
    this.zoom = nz;
    this.scale = this.baseScale * this.zoom;
    this.th = TILE_H * this.scale;
    this.panX = nOx - this.w / 2;
    this.panY = nOy - ((this.h - GRID * this.th) / 2 + this.th);
    this.applyView();
  }

  pan(dx, dy) {
    this.panX += dx;
    this.panY += dy;
    this.applyView();
  }

  resetView() {
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.applyView();
  }

  toScreen(x, y) {
    return {
      sx: this.originX + (x - y) * (this.tw / 2),
      sy: this.originY + (x + y) * (this.th / 2),
    };
  }

  toGrid(sx, sy) {
    const a = (sx - this.originX) / (this.tw / 2);
    const b = (sy - this.originY) / (this.th / 2);
    return { x: Math.floor((a + b) / 2 + 0.5), y: Math.floor((b - a) / 2 + 0.5) };
  }

  diamond(sx, sy, scale = 1) {
    const ctx = this.ctx;
    const hw = (this.tw / 2) * scale, hh = (this.th / 2) * scale;
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh);
    ctx.lineTo(sx + hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx - hw, sy);
    ctx.closePath();
  }

  box(sx, sy, h, top, left, right, scale = 0.82) {
    const ctx = this.ctx;
    const hw = (this.tw / 2) * scale, hh = (this.th / 2) * scale;
    h *= this.scale;
    const az = this.sunAz ?? 0.4;
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(sx - hw, sy); ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx, sy + hh - h); ctx.lineTo(sx - hw, sy - h);
    ctx.closePath(); ctx.fill();
    // Morning sun lights the west face...
    if (az < -0.05) {
      ctx.fillStyle = `rgba(255, 245, 215, ${Math.min(0.2, -az * 0.2)})`;
      ctx.fill();
    }
    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(sx + hw, sy); ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx, sy + hh - h); ctx.lineTo(sx + hw, sy - h);
    ctx.closePath(); ctx.fill();
    // ...and the afternoon sun lights the east face.
    if (az > 0.05) {
      ctx.fillStyle = `rgba(255, 245, 215, ${Math.min(0.2, az * 0.2)})`;
      ctx.fill();
    }
    ctx.fillStyle = top;
    this.diamond(sx, sy - h, scale);
    ctx.fill();
    // Sun-catch rim on the roof, grounding seam, and a soft silhouette
    // outline that gives everything an illustrated crispness.
    ctx.strokeStyle = 'rgba(255, 245, 220, 0.20)';
    ctx.lineWidth = 1;
    this.diamond(sx, sy - h, scale);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(22, 26, 34, 0.35)';
    ctx.beginPath();
    ctx.moveTo(sx - hw, sy - h);
    ctx.lineTo(sx - hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx + hw, sy);
    ctx.lineTo(sx + hw, sy - h);
    ctx.stroke();
  }

  // Sun shadow that swings with the time of day: west in the morning,
  // east in the evening, longest at golden hour, gone at night.
  castShadow(sx, sy, h, footprint = 0.8) {
    const ctx = this.ctx;
    const alpha = this.shadowAlpha ?? 0.3;
    if (alpha <= 0.01) return;
    const az = this.sunAz ?? 0.4;
    const stretch = this.shadowStretch ?? 1;
    ctx.fillStyle = `rgba(10, 14, 22, ${alpha})`;
    ctx.beginPath();
    ctx.ellipse(
      sx + az * (6 + h * 0.35) * this.scale, sy + 2.5 * this.scale,
      (this.tw / 2) * footprint * (0.75 + h * 0.005) * stretch,
      (this.th / 2) * footprint * 0.8,
      -0.30 * az, 0, Math.PI * 2,
    );
    ctx.fill();
  }

  // Screen-space unit vector for a grid direction.
  isoUnit(dx, dy) {
    const vx = (dx - dy) * (this.tw / 2), vy = (dx + dy) * (this.th / 2);
    const len = Math.hypot(vx, vy) || 1;
    return { x: vx / len, y: vy / len };
  }

  // Filled parallelogram centered at (cx,cy), aligned to u, half-length L,
  // perpendicular p, half-width W — the building block for vehicles.
  quad(cx, cy, u, L, p, W, color) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx + u.x * L + p.x * W, cy + u.y * L + p.y * W);
    ctx.lineTo(cx + u.x * L - p.x * W, cy + u.y * L - p.y * W);
    ctx.lineTo(cx - u.x * L - p.x * W, cy - u.y * L - p.y * W);
    ctx.lineTo(cx - u.x * L + p.x * W, cy - u.y * L + p.y * W);
    ctx.closePath();
    ctx.fill();
  }

  districtOf(x, y) {
    return DISTRICTS.find((d) => {
      const [x0, y0, x1, y1] = d.rect;
      return x >= x0 && x < x1 && y >= y0 && y < y1;
    });
  }

  // 0 at midday, up to ~0.5 in the dead of night.
  darkness() {
    const t = this.game.dayFrac();
    return Math.pow(0.5 + 0.5 * Math.cos(2 * Math.PI * t), 1.4) * 0.5;
  }

  // ---- ambient life ------------------------------------------------------

  doorOf(x, y) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      if (isRoad(x + dx, y + dy)) return { x: x + dx, y: y + dy };
    }
    return null;
  }

  updateAmbient() {
    const now = performance.now();
    const realDt = Math.min(0.1, (now - this.lastReal) / 1000);
    this.lastReal = now;
    const g = this.game;
    if (g.speed === 0 || g.gameOver) return;
    const dt = realDt;

    // Cars cruise the road grid.
    this.carClock += dt;
    if (this.carClock > 0.7 && this.cars.length < 20) {
      this.carClock = 0;
      const horizontal = Math.random() < 0.5;
      const dir = Math.random() < 0.5 ? 1 : -1;
      const roll = Math.random();
      const type = roll < 0.15 ? 'taxi' : roll < 0.38 ? 'van' : 'sedan';
      this.cars.push({
        horizontal,
        line: ROAD_LINES[Math.floor(Math.random() * ROAD_LINES.length)],
        dir,
        type,
        pos: dir > 0 ? -1.5 : GRID + 0.5,
        speed: 2.2 + Math.random() * 1.8,
        color: type === 'taxi'
          ? '#e8c33a'
          : CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)],
      });
    }
    for (const c of this.cars) c.pos += c.dir * c.speed * dt;
    this.cars = this.cars.filter((c) => c.pos > -2 && c.pos < GRID + 1);

    // Ambient strollers wander the sidewalks anywhere in town.
    if (Math.random() < dt * 1.2 && this.walkers.length < 52) {
      const lx = ROAD_LINES[Math.floor(Math.random() * ROAD_LINES.length)];
      const along = Math.random() * (GRID - 1);
      const horizontal = Math.random() < 0.5;
      const fx = horizontal ? along : lx + 0.4;
      const fy = horizontal ? lx + 0.4 : along;
      const dist = 1.5 + Math.random() * 2.5;
      this.walkers.push({
        fx, fy,
        tx: horizontal ? fx + (Math.random() < 0.5 ? dist : -dist) : fx,
        ty: horizontal ? fy : fy + (Math.random() < 0.5 ? dist : -dist),
        age: 0, ttl: 4 + Math.random() * 3,
        color: WALKER_COLORS[Math.floor(Math.random() * WALKER_COLORS.length)],
      });
    }

    // Shoppers walk from the sidewalk into stores — busier stores draw more.
    this.walkerClock += dt;
    if (this.walkerClock > 0.45 && this.walkers.length < 40 && g.stores.length) {
      this.walkerClock = 0;
      const store = g.stores[Math.floor(Math.random() * g.stores.length)];
      const site = g.site(store.siteId);
      // Spawn odds follow how much of its neighborhood the store captures.
      if (Math.random() < 0.35 + 0.65 * g.marketFactor(store)) {
        const door = this.doorOf(site.x, site.y);
        if (door) {
          const along = (Math.random() - 0.5) * 1.6;
          const horizontalRoad = door.y % 4 === 0;
          const from = {
            x: door.x + (horizontalRoad ? along : 0),
            y: door.y + (horizontalRoad ? 0 : along),
          };
          const leaving = Math.random() < 0.45;
          this.walkers.push({
            fx: leaving ? site.x : from.x, fy: leaving ? site.y : from.y,
            tx: leaving ? from.x : site.x, ty: leaving ? from.y : site.y,
            age: 0, ttl: 2 + Math.random() * 1.2,
            color: WALKER_COLORS[Math.floor(Math.random() * WALKER_COLORS.length)],
          });
        }
      }
    }
    for (const p of this.walkers) p.age += dt;
    this.walkers = this.walkers.filter((p) => p.age < p.ttl);

    // Exhaust puffs trail moving trucks.
    for (const t of g.trucks) {
      if ((t.state === 'toStore' || t.state === 'return') && t.path && Math.random() < dt * 6) {
        const i = Math.min(t.path.length - 1, Math.floor(t.pos));
        const a = t.path[i];
        this.puffs.push({ x: a.x + (Math.random() - 0.5) * 0.3, y: a.y + (Math.random() - 0.5) * 0.3, age: 0 });
      }
    }
    for (const p of this.puffs) p.age += dt;
    this.puffs = this.puffs.filter((p) => p.age < 1.1);

    // Passing weather: rain showers in the green seasons, snowfall in winter.
    this.weatherClock += dt;
    const sid2 = g.season?.().id;
    if (!this.weather && this.weatherClock > 8) {
      this.weatherClock = 0;
      const chance = sid2 === 'winter' ? 0.30 : sid2 === 'summer' ? 0.08 : 0.16;
      if (Math.random() < chance) {
        this.weather = { type: sid2 === 'winter' ? 'snow' : 'rain', ttl: 12 + Math.random() * 14 };
        this.drops = Array.from({ length: this.weather.type === 'snow' ? 70 : 90 }, () => ({
          x: Math.random(), y: Math.random(), v: 0.5 + Math.random() * 0.7, ph: Math.random() * 6,
        }));
      }
    }
    if (this.weather) {
      this.weather.ttl -= dt;
      const fall = this.weather.type === 'snow' ? 0.06 : 0.55;
      for (const p of this.drops) {
        p.y += p.v * fall * dt;
        if (this.weather.type === 'snow') p.x += Math.sin(performance.now() / 900 + p.ph) * dt * 0.02;
        if (p.y > 1) { p.y = -0.02; p.x = Math.random(); }
      }
      if (this.weather.ttl <= 0) { this.weather = null; this.drops = []; }
    }

    // Seasonal motes: petals in spring, leaves in fall, fireflies on
    // summer nights.
    this.moteClock += dt;
    const dark2 = this.darkness();
    const moteType = sid2 === 'spring' ? 'petal'
      : sid2 === 'fall' ? 'leaf'
      : (sid2 === 'summer' && dark2 > 0.2) ? 'firefly' : null;
    if (moteType && this.moteClock > 0.35 && this.motes.length < (moteType === 'firefly' ? 18 : 26)) {
      this.moteClock = 0;
      this.motes.push({
        type: moteType,
        x: Math.random(), y: moteType === 'firefly' ? 0.3 + Math.random() * 0.6 : -0.03,
        vx: (Math.random() - 0.3) * 0.03, ph: Math.random() * 6, ttl: 12,
      });
    }
    for (const m2 of this.motes) {
      m2.ttl -= dt;
      if (m2.type === 'firefly') {
        m2.x += Math.sin(performance.now() / 1300 + m2.ph) * dt * 0.02;
        m2.y += Math.cos(performance.now() / 1700 + m2.ph) * dt * 0.015;
      } else {
        m2.y += dt * (m2.type === 'petal' ? 0.045 : 0.06);
        m2.x += m2.vx * dt + Math.sin(performance.now() / 800 + m2.ph) * dt * 0.01;
      }
    }
    this.motes = this.motes.filter((m2) => m2.ttl > 0 && m2.y < 1.05
      && (moteType === m2.type || m2.type !== 'firefly'));

    // Lightning during heavy rain.
    if (this.weather?.type === 'rain' && !this.lightning && Math.random() < dt * 0.08) {
      this.lightning = { t: 0.5, x: 0.15 + Math.random() * 0.7 };
    }
    if (this.lightning) {
      this.lightning.t -= dt;
      if (this.lightning.t <= 0) this.lightning = null;
    }

    // A flock of birds crosses the sky now and then.
    this.birdClock += dt;
    if (this.birdClock > 14 && this.birds.length === 0) {
      this.birdClock = 0;
      const y0 = 0.15 + Math.random() * 0.4;
      const dir = Math.random() < 0.5 ? 1 : -1;
      for (let i = 0; i < 4 + Math.floor(Math.random() * 3); i++) {
        this.birds.push({
          x: dir > 0 ? -0.05 - i * 0.02 : 1.05 + i * 0.02,
          y: y0 + (i % 2) * 0.02 + i * 0.008,
          dir, phase: Math.random() * 6,
        });
      }
    }
    for (const b of this.birds) b.x += b.dir * dt * 0.06;
    this.birds = this.birds.filter((b) => b.x > -0.1 && b.x < 1.1);

    // Clouds drift; a rowboat plies the river.
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > 1.15) { c.x = -0.2; c.y = 0.12 + Math.random() * 0.55; }
    }
    this.boat.t += dt * 0.02 * this.boat.dir;
    if (this.boat.t > 1) { this.boat.t = 1; this.boat.dir = -1; }
    if (this.boat.t < 0) { this.boat.t = 0; this.boat.dir = 1; }
  }

  // ---- main draw ---------------------------------------------------------

  draw(hover, selectedSiteId) {
    const ctx = this.ctx;
    const g = this.game;
    this.updateAmbient();
    const dark = this.darkness();
    // Sun azimuth: shadows point west in the morning, east in the evening,
    // stretch when the sun is low, and fade away at night.
    const tf = g.dayFrac();
    const az = Math.max(-1, Math.min(1, (tf - 0.5) * 3.2));
    this.sunAz = az;
    this.shadowStretch = 1 + Math.abs(az) * 0.7;
    this.shadowAlpha = Math.max(0, 0.30 - dark * 0.55);
    this.drawBackdrop(dark);

    // Ground: static layer from cache, animated river on top.
    this.ensureGroundCache();
    ctx.drawImage(this.groundCache, this.originX - this.groundOx, this.originY - this.groundOy,
      this.groundCssW, this.groundCssH);
    for (let y = 13; y < GRID; y++) {
      if (!isRoad(1, y)) this.drawRiverTile(1, y);
    }

    // Cloud shadows sweep the ground.
    for (const c of this.clouds) {
      ctx.fillStyle = 'rgba(8, 12, 20, 0.10)';
      ctx.beginPath();
      ctx.ellipse(c.x * this.w + 40, c.y * this.h + 110, 90 * c.s, 34 * c.s, -0.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Dashed frontier around districts you haven't unlocked yet.
    ctx.setLineDash([7, 6]);
    ctx.lineWidth = 1.5;
    for (const d of DISTRICTS) {
      if (g.districtUnlocked(d.id)) continue;
      const [x0, y0, x1, y1] = d.rect;
      const c1 = this.toScreen(x0 - 0.5, y0 - 0.5);
      const c2 = this.toScreen(x1 - 0.5, y0 - 0.5);
      const c3 = this.toScreen(x1 - 0.5, y1 - 0.5);
      const c4 = this.toScreen(x0 - 0.5, y1 - 0.5);
      ctx.strokeStyle = 'rgba(232, 130, 140, 0.45)';
      ctx.beginPath();
      ctx.moveTo(c1.sx, c1.sy);
      ctx.lineTo(c2.sx, c2.sy);
      ctx.lineTo(c3.sx, c3.sy);
      ctx.lineTo(c4.sx, c4.sy);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // World pass: everything with height, painter-sorted.
    const drawables = [];
    // Streetlights on intersection corners; hydrants on some blocks.
    for (const lx of ROAD_LINES) {
      for (const ly of ROAD_LINES) {
        const px = lx + 0.42, py = ly + 0.42;
        if (px < GRID && py < GRID) {
          drawables.push({ key: px + py, kind: 'lamp', fx: px, fy: py });
        }
      }
    }
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        if (isRoad(x, y) && !(x % 4 === 0 && y % 4 === 0) && hash(x + 13, y + 4) < 0.06) {
          drawables.push({ key: x + y + 0.005, kind: 'hydrant', fx: x + 0.38, fy: y + 0.38 });
        }
      }
    }
    // The rowboat drifts along the river.
    {
      const by = 13.5 + this.boat.t * 9;
      drawables.push({ key: 1 + by, kind: 'boat', fx: 1, fy: by });
    }
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        if (isRoad(x, y) || isRiver(x, y)) continue;
        if (x === WAREHOUSE.x && y === WAREHOUSE.y) {
          drawables.push({ key: x + y, kind: 'warehouse', x, y });
          continue;
        }
        const site = g.siteAtTile(x, y);
        if (site) {
          drawables.push({ key: x + y, kind: 'site', x, y, site });
          continue;
        }
        if (isPark(x, y)) {
          drawables.push({ key: x + y, kind: 'park', x, y });
          continue;
        }
        const lm = landmarkAt(x, y);
        if (lm) {
          drawables.push({ key: x + y, kind: lm.kind, x, y });
          continue;
        }
        const r = hash(x, y);
        if (r < 0.30) drawables.push({ key: x + y, kind: 'house', x, y, r });
        else if (r < 0.44) drawables.push({ key: x + y, kind: 'tree', x, y, r });
        else if (r >= 0.50 && r < 0.55) drawables.push({ key: x + y, kind: 'hedge', x, y, r });
      }
    }
    for (const t of g.trucks) {
      if (t.state === 'idle' || !t.path) continue;
      let x, y, dx, dy, unloading = false;
      if (t.state === 'unloading') {
        // Parked at the store's door, nose pointed at the store.
        const end = t.path[t.path.length - 1];
        const site = g.site(t.storeId);
        x = end.x; y = end.y;
        dx = site ? Math.sign(site.x - end.x) : 1;
        dy = site ? Math.sign(site.y - end.y) : 0;
        unloading = true;
      } else {
        const i = Math.min(t.path.length - 1, Math.floor(t.pos));
        const frac = Math.min(1, t.pos - i);
        const a = t.path[i], b = t.path[Math.min(t.path.length - 1, i + 1)];
        x = a.x + (b.x - a.x) * frac;
        y = a.y + (b.y - a.y) * frac;
        dx = Math.sign(b.x - a.x) || 1;
        dy = Math.sign(b.y - a.y) || 0;
        // Keep to the right-hand lane.
        x += -dy * 0.18;
        y += dx * 0.18;
      }
      drawables.push({
        key: x + y + 0.01, kind: 'truck', fx: x, fy: y, dx, dy,
        unloading, storeId: t.storeId,
      });
    }
    for (const c of this.cars) {
      const lane = 0.22 * c.dir;
      const x = c.horizontal ? c.pos : c.line + lane;
      const y = c.horizontal ? c.line - lane : c.pos;
      if (x < -0.5 || y < -0.5 || x > GRID - 0.5 || y > GRID - 0.5) continue;
      drawables.push({ key: x + y + 0.02, kind: 'car', fx: x, fy: y, car: c });
    }
    for (const p of this.walkers) {
      const t = Math.min(1, p.age / p.ttl);
      const x = p.fx + (p.tx - p.fx) * t;
      const y = p.fy + (p.ty - p.fy) * t;
      drawables.push({ key: x + y + 0.03, kind: 'walker', fx: x, fy: y, w: p });
    }
    drawables.sort((a, b) => a.key - b.key);
    for (const d of drawables) this.drawThing(d, selectedSiteId);

    // Falling weather + overcast tint.
    if (this.weather) {
      ctx.fillStyle = 'rgba(60, 68, 84, 0.14)';
      ctx.fillRect(0, 0, this.w, this.h);
      if (this.weather.type === 'rain') {
        ctx.strokeStyle = 'rgba(190, 215, 240, 0.45)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (const p of this.drops) {
          const px = p.x * this.w, py = p.y * this.h;
          ctx.moveTo(px, py);
          ctx.lineTo(px - 2.5, py + 9);
        }
        ctx.stroke();
      } else {
        ctx.fillStyle = 'rgba(245, 248, 252, 0.85)';
        for (const p of this.drops) {
          ctx.beginPath();
          ctx.arc(p.x * this.w, p.y * this.h, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Seasonal motes.
    for (const m2 of this.motes) {
      const mx = m2.x * this.w, my = m2.y * this.h;
      if (m2.type === 'petal') {
        ctx.fillStyle = 'rgba(248, 190, 210, 0.8)';
        ctx.fillRect(mx, my, 2.4, 2);
      } else if (m2.type === 'leaf') {
        ctx.fillStyle = 'rgba(216, 140, 60, 0.85)';
        ctx.save();
        ctx.translate(mx, my);
        ctx.rotate(Math.sin(performance.now() / 500 + m2.ph));
        ctx.fillRect(-1.6, -1.1, 3.2, 2.2);
        ctx.restore();
      } else {
        const pulse = 0.4 + 0.6 * Math.abs(Math.sin(performance.now() / 600 + m2.ph));
        ctx.fillStyle = `rgba(220, 255, 140, ${0.75 * pulse})`;
        ctx.beginPath();
        ctx.arc(mx, my, 1.6 + pulse, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Lightning: a flash and a jagged bolt.
    if (this.lightning) {
      const lt = this.lightning.t;
      ctx.fillStyle = `rgba(240, 245, 255, ${Math.min(0.35, lt * 0.7)})`;
      ctx.fillRect(0, 0, this.w, this.h);
      if (lt > 0.3) {
        ctx.strokeStyle = `rgba(255, 255, 240, ${(lt - 0.3) * 4})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        let lx = this.lightning.x * this.w, ly = 0;
        ctx.moveTo(lx, ly);
        while (ly < this.h * 0.55) {
          lx += (hash(Math.round(lx), Math.round(ly)) - 0.5) * 46;
          ly += 30 + hash(Math.round(ly), 3) * 30;
          ctx.lineTo(lx, ly);
        }
        ctx.stroke();
      }
    }

    // Golden-hour grade at dawn and dusk.
    const tFrac = g.dayFrac();
    const glow1 = Math.max(0, 1 - Math.abs(tFrac - 0.26) / 0.07);
    const glow2 = Math.max(0, 1 - Math.abs(tFrac - 0.74) / 0.07);
    const golden = Math.max(glow1, glow2);
    if (golden > 0.03) {
      ctx.fillStyle = `rgba(255, 148, 72, ${golden * 0.13})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }

    // Midday warmth, then night overlay with glowing lights.
    const warm = Math.max(0, 0.05 - dark * 0.15);
    if (warm > 0.004) {
      ctx.fillStyle = `rgba(255, 214, 150, ${warm})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
    if (dark > 0.02) {
      ctx.fillStyle = `rgba(8, 12, 38, ${dark})`;
      ctx.fillRect(0, 0, this.w, this.h);
      if (dark > 0.12) this.drawLights(drawables, dark);
    }

    // Birds overhead.
    if (dark < 0.25) {
      ctx.strokeStyle = `rgba(40, 46, 56, ${0.7 - dark * 2})`;
      ctx.lineWidth = 1.4;
      for (const b of this.birds) {
        const bx = b.x * this.w, by = b.y * this.h;
        const flap = Math.sin(performance.now() / 130 + b.phase) * 2.5;
        ctx.beginPath();
        ctx.moveTo(bx - 4, by - flap);
        ctx.lineTo(bx, by + 1.5);
        ctx.lineTo(bx + 4, by - flap);
        ctx.stroke();
      }
    }

    // Cloud puffs float above it all (dimmer at night).
    const cloudAlpha = 0.20 * (1 - dark * 1.6);
    if (cloudAlpha > 0.02) {
      for (const c of this.clouds) {
        const px = c.x * this.w, py = c.y * this.h;
        ctx.fillStyle = `rgba(235, 240, 248, ${cloudAlpha})`;
        for (const [ox, oy, r] of [[0, 0, 34], [-30, 6, 24], [30, 7, 26]]) {
          ctx.beginPath();
          ctx.ellipse(px + ox * c.s, py + oy * c.s, r * c.s, r * 0.42 * c.s, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Cinematic grade: warm center, cool edges, blended overlay-style.
    ctx.save();
    ctx.globalCompositeOperation = 'overlay';
    const grade = ctx.createRadialGradient(
      this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.2,
      this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.7,
    );
    grade.addColorStop(0, 'rgba(255, 214, 160, 0.14)');
    grade.addColorStop(1, 'rgba(70, 100, 160, 0.12)');
    ctx.fillStyle = grade;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.restore();

    // Soft vignette pulls focus to the city.
    const vg = ctx.createRadialGradient(
      this.w / 2, this.h / 2, Math.min(this.w, this.h) * 0.42,
      this.w / 2, this.h / 2, Math.max(this.w, this.h) * 0.72,
    );
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.18)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, this.w, this.h);

    // District labels, tinted with each district's identity color.
    const DISTRICT_RGB = {
      oldtown: '242, 193, 78', westside: '127, 178, 229',
      riverside: '111, 208, 140', downtown: '178, 138, 224',
    };
    ctx.textAlign = 'center';
    for (const d of DISTRICTS) {
      const [x0, y0, x1, y1] = d.rect;
      const { sx, sy } = this.toScreen((x0 + x1) / 2 - 0.5, (y0 + y1) / 2 - 0.5);
      const locked = !g.districtUnlocked(d.id);
      ctx.font = `700 ${13 * this.scale + 4}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
      ctx.fillText(d.name.toUpperCase(), sx + 1, sy + 1);
      ctx.fillStyle = `rgba(${DISTRICT_RGB[d.id]}, ${locked ? 0.55 : 0.34})`;
      ctx.fillText(d.name.toUpperCase(), sx, sy);
      if (locked) {
        ctx.font = `${11 * this.scale + 3}px system-ui, sans-serif`;
        ctx.fillStyle = 'rgba(232, 130, 140, 0.85)';
        ctx.fillText(`🔒 unlocks at $${d.unlock.toLocaleString()}`, sx, sy + 16);
      }
    }

    // Hover highlight.
    if (hover) {
      const { sx, sy } = this.toScreen(hover.x, hover.y);
      ctx.strokeStyle = 'rgba(242, 193, 78, 0.9)';
      ctx.lineWidth = 2;
      this.diamond(sx, sy);
      ctx.stroke();
    }

    // Floating texts.
    ctx.font = `700 ${12 * this.scale + 2}px system-ui, sans-serif`;
    for (const f of g.floaters) {
      const { sx, sy } = this.toScreen(f.x, f.y);
      ctx.globalAlpha = Math.max(0, 1 - f.age / 1.6);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sx, sy - 40 * this.scale - f.age * 16 - (f.stack || 0) * 15);
    }
    ctx.globalAlpha = 1;
  }


  // Sky, celestial bodies, distant skyline, and the diorama slab the city
  // sits on. Drawn before the ground each frame.
  drawBackdrop(dark) {
    const ctx = this.ctx;
    const g = this.game;
    const t = g.dayFrac();
    const day = Math.max(0, 1 - dark * 2.2);
    const lerp = (a, b, k) => Math.round(a + (b - a) * k);
    // Sky gradient.
    const skyTop = `rgb(${lerp(10, 74, day)}, ${lerp(14, 110, day)}, ${lerp(34, 158, day)})`;
    const skyBot = `rgb(${lerp(22, 148, day)}, ${lerp(28, 178, day)}, ${lerp(50, 205, day)})`;
    const sky = ctx.createLinearGradient(0, 0, 0, this.h);
    sky.addColorStop(0, skyTop);
    sky.addColorStop(0.55, skyBot);
    sky.addColorStop(1, skyTop);
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, this.w, this.h);
    // Golden horizon at dawn/dusk.
    const golden = Math.max(
      Math.max(0, 1 - Math.abs(t - 0.26) / 0.09),
      Math.max(0, 1 - Math.abs(t - 0.74) / 0.09),
    );
    if (golden > 0.03) {
      const gh = ctx.createLinearGradient(0, this.h * 0.15, 0, this.h * 0.55);
      gh.addColorStop(0, 'rgba(255, 150, 70, 0)');
      gh.addColorStop(1, `rgba(255, 150, 70, ${golden * 0.35})`);
      ctx.fillStyle = gh;
      ctx.fillRect(0, 0, this.w, this.h * 0.55);
    }
    // Stars twinkle out of the darkness.
    if (dark > 0.12) {
      for (const s of this.stars) {
        const a = (dark * 2 - 0.2) * (0.5 + 0.5 * Math.sin(performance.now() / 700 + s.tw));
        ctx.fillStyle = `rgba(235, 240, 255, ${Math.max(0, Math.min(0.9, a))})`;
        ctx.fillRect(s.x * this.w, s.y * this.h, 1.4, 1.4);
      }
    }
    // Sun and moon ride opposite arcs.
    const arc = (p) => ({
      x: this.w * (0.12 + 0.76 * p),
      y: this.h * 0.40 - Math.sin(Math.max(0, Math.min(1, p)) * Math.PI) * this.h * 0.26,
    });
    const sunP = (t - 0.25) / 0.5;
    if (sunP > -0.05 && sunP < 1.05) {
      const { x, y } = arc(sunP);
      const sg = ctx.createRadialGradient(x, y, 2, x, y, 34);
      sg.addColorStop(0, 'rgba(255, 244, 200, 0.95)');
      sg.addColorStop(0.3, 'rgba(255, 220, 130, 0.55)');
      sg.addColorStop(1, 'rgba(255, 200, 90, 0)');
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(x, y, 34, 0, Math.PI * 2);
      ctx.fill();
    }
    const moonP = (((t + 0.5) % 1) - 0.25) / 0.5;
    if (dark > 0.08 && moonP > 0 && moonP < 1) {
      const { x, y } = arc(moonP);
      ctx.fillStyle = `rgba(226, 232, 244, ${Math.min(0.9, dark * 2)})`;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = skyTop;
      ctx.beginPath();
      ctx.arc(x + 3.5, y - 2, 7.5, 0, Math.PI * 2);
      ctx.fill();
    }
    // Distant skyline with parallax; windows light up at night.
    const horizon = this.originY - this.th * 1.2;
    const par = this.panX * 0.25;
    ctx.save();
    for (let i = -2; i < Math.ceil(this.w / 30) + 2; i++) {
      const bx = ((i * 30 - par) % (this.w + 120) + this.w + 120) % (this.w + 120) - 60;
      const bh = 18 + hash(i + 50, 3) * 46;
      const bw = 16 + hash(i, 9) * 16;
      ctx.fillStyle = `rgba(${lerp(30, 96, day)}, ${lerp(36, 116, day)}, ${lerp(54, 142, day)}, 0.85)`;
      ctx.fillRect(bx, horizon - bh, bw, bh);
      if (dark > 0.15) {
        ctx.fillStyle = `rgba(255, 224, 150, ${0.5 * Math.min(1, dark * 2)})`;
        for (let wy = 0; wy < 3; wy++) {
          for (let wx = 0; wx < 2; wx++) {
            if (hash(i * 7 + wx, wy + 2) < 0.4) {
              ctx.fillRect(bx + 3 + wx * 7, horizon - bh + 4 + wy * 9, 2, 2.6);
            }
          }
        }
      }
    }
    // Haze where skyline meets ground.
    const hz = ctx.createLinearGradient(0, horizon - 8, 0, horizon + 26);
    hz.addColorStop(0, 'rgba(200, 215, 230, 0)');
    hz.addColorStop(1, `rgba(${lerp(20, 190, day)}, ${lerp(26, 205, day)}, ${lerp(44, 222, day)}, 0.5)`);
    ctx.fillStyle = hz;
    ctx.fillRect(0, horizon - 8, this.w, 34);
    ctx.restore();
    // Diorama slab: the city block floats like a model on earth strata.
    const D = 30 * this.scale;
    const north = this.toScreen(0, 0);
    const east = this.toScreen(GRID - 1, 0);
    const south = this.toScreen(GRID - 1, GRID - 1);
    const west = this.toScreen(0, GRID - 1);
    const pts = {
      e: { x: east.sx + this.tw / 2, y: east.sy },
      s: { x: south.sx, y: south.sy + this.th / 2 },
      w: { x: west.sx - this.tw / 2, y: west.sy },
    };
    ctx.fillStyle = '#5d4a38';
    ctx.beginPath();
    ctx.moveTo(pts.w.x, pts.w.y);
    ctx.lineTo(pts.s.x, pts.s.y);
    ctx.lineTo(pts.s.x, pts.s.y + D);
    ctx.lineTo(pts.w.x, pts.w.y + D);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6d5946';
    ctx.beginPath();
    ctx.moveTo(pts.s.x, pts.s.y);
    ctx.lineTo(pts.e.x, pts.e.y);
    ctx.lineTo(pts.e.x, pts.e.y + D);
    ctx.lineTo(pts.s.x, pts.s.y + D);
    ctx.closePath();
    ctx.fill();
    // Strata lines and a grassy lip.
    ctx.strokeStyle = 'rgba(40, 30, 20, 0.35)';
    ctx.lineWidth = 1;
    for (const f of [0.35, 0.7]) {
      ctx.beginPath();
      ctx.moveTo(pts.w.x, pts.w.y + D * f);
      ctx.lineTo(pts.s.x, pts.s.y + D * f);
      ctx.lineTo(pts.e.x, pts.e.y + D * f);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(96, 130, 70, 0.9)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(pts.w.x, pts.w.y);
    ctx.lineTo(pts.s.x, pts.s.y);
    ctx.lineTo(pts.e.x, pts.e.y);
    ctx.stroke();
  }

  // Paint every ground tile (called once per cache rebuild).
  paintGround() {
    const ctx = this.ctx;
    const g = this.game;
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const { sx, sy } = this.toScreen(x, y);
        const district = this.districtOf(x, y);
        const locked = !g.districtUnlocked(district.id);
        if (isRoad(x, y)) {
          // Concrete sidewalk ring with an asphalt roadbed inset into it.
          ctx.fillStyle = locked ? '#565c66' : '#9aa1ab';
          this.diamond(sx, sy);
          ctx.fill();
          ctx.fillStyle = locked ? '#343941' : '#5a616b';
          this.diamond(sx, sy, 0.80);
          ctx.fill();
          // Sidewalk expansion seams.
          if (!locked) {
            const rv = hash(x, y);
            ctx.strokeStyle = 'rgba(60, 66, 76, 0.35)';
            ctx.lineWidth = 1;
            const vertical0 = x % 4 === 0 && y % 4 !== 0;
            const u0 = this.isoUnit(vertical0 ? 0 : 1, vertical0 ? 1 : 0);
            const p0 = { x: -u0.y, y: u0.x };
            for (const t of [-0.25, 0.25]) {
              for (const side of [-0.44, 0.44]) {
                const bx = sx + u0.x * this.tw * t + p0.x * this.tw * side;
                const by = sy + u0.y * this.tw * t + p0.y * this.tw * side;
                ctx.beginPath();
                ctx.moveTo(bx - p0.x * this.tw * 0.05, by - p0.y * this.tw * 0.05);
                ctx.lineTo(bx + p0.x * this.tw * 0.05, by + p0.y * this.tw * 0.05);
                ctx.stroke();
              }
            }
            // The odd manhole cover.
            if (rv > 0.55 && rv < 0.62 && !(x % 4 === 0 && y % 4 === 0)) {
              ctx.fillStyle = 'rgba(42, 47, 55, 0.8)';
              ctx.beginPath();
              ctx.ellipse(sx + (rv - 0.585) * 40, sy + 2, 3.2 * this.scale, 1.8 * this.scale, 0, 0, Math.PI * 2);
              ctx.fill();
            }
          }
          // Railings where the road bridges the river.
          if (x === 1 && y >= 13) {
            ctx.strokeStyle = 'rgba(180, 188, 198, 0.9)';
            ctx.lineWidth = 1.6;
            const hwb = this.tw / 2, hhb = this.th / 2;
            ctx.beginPath();
            ctx.moveTo(sx - hwb * 0.9, sy - 3 * this.scale);
            ctx.lineTo(sx, sy + hhb * 0.9 - 3 * this.scale);
            ctx.moveTo(sx, sy - hhb * 0.9 - 3 * this.scale);
            ctx.lineTo(sx + hwb * 0.9, sy - 3 * this.scale);
            ctx.stroke();
          }
          const intersection = x % 4 === 0 && y % 4 === 0;
          if (!locked && !intersection) {
            // Dashed center line along the street.
            const vertical = x % 4 === 0;
            const u = this.isoUnit(vertical ? 0 : 1, vertical ? 1 : 0);
            {
              // Tire-worn lanes and gutter shading.
              const pw = { x: -u.y, y: u.x };
              ctx.strokeStyle = 'rgba(30, 34, 42, 0.16)';
              ctx.lineWidth = 3.2 * this.scale;
              for (const lane of [-0.2, 0.2]) {
                ctx.beginPath();
                ctx.moveTo(sx - u.x * this.tw * 0.45 + pw.x * this.tw * lane,
                  sy - u.y * this.tw * 0.45 + pw.y * this.tw * lane);
                ctx.lineTo(sx + u.x * this.tw * 0.45 + pw.x * this.tw * lane,
                  sy + u.y * this.tw * 0.45 + pw.y * this.tw * lane);
                ctx.stroke();
              }
              ctx.strokeStyle = 'rgba(20, 24, 32, 0.22)';
              ctx.lineWidth = 1.2;
              for (const side of [-0.385, 0.385]) {
                ctx.beginPath();
                ctx.moveTo(sx - u.x * this.tw * 0.5 + pw.x * this.tw * side,
                  sy - u.y * this.tw * 0.5 + pw.y * this.tw * side);
                ctx.lineTo(sx + u.x * this.tw * 0.5 + pw.x * this.tw * side,
                  sy + u.y * this.tw * 0.5 + pw.y * this.tw * side);
                ctx.stroke();
              }
              // Stop line just before an intersection.
              const nextIsX = vertical ? (y + 1) % 4 === 0 : (x + 1) % 4 === 0;
              if (nextIsX) {
                ctx.strokeStyle = 'rgba(235, 238, 245, 0.5)';
                ctx.lineWidth = 2 * this.scale;
                ctx.beginPath();
                ctx.moveTo(sx + u.x * this.tw * 0.34 - pw.x * this.tw * 0.3,
                  sy + u.y * this.tw * 0.34 - pw.y * this.tw * 0.3);
                ctx.lineTo(sx + u.x * this.tw * 0.34 + pw.x * this.tw * 0.02,
                  sy + u.y * this.tw * 0.34 + pw.y * this.tw * 0.02);
                ctx.stroke();
              }
            }
            ctx.strokeStyle = 'rgba(240, 220, 140, 0.55)';
            ctx.lineWidth = 1.2;
            for (const t of [-0.28, 0.08]) {
              ctx.beginPath();
              ctx.moveTo(sx + u.x * this.tw * t, sy + u.y * this.tw * t);
              ctx.lineTo(sx + u.x * this.tw * (t + 0.18), sy + u.y * this.tw * (t + 0.18));
              ctx.stroke();
            }
          } else if (!locked && intersection) {
            // Zebra crosswalks on each approach.
            ctx.strokeStyle = 'rgba(235, 240, 248, 0.40)';
            ctx.lineWidth = 1.5;
            for (const [ddx, ddy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const u = this.isoUnit(ddx, ddy);
              const p = { x: -u.y, y: u.x };
              for (const s of [-0.09, 0, 0.09]) {
                const bx = sx + u.x * this.tw * 0.30 + p.x * this.tw * s;
                const by = sy + u.y * this.tw * 0.30 + p.y * this.tw * s;
                ctx.beginPath();
                ctx.moveTo(bx - u.x * this.tw * 0.035, by - u.y * this.tw * 0.035);
                ctx.lineTo(bx + u.x * this.tw * 0.035, by + u.y * this.tw * 0.035);
                ctx.stroke();
              }
            }
          }
        } else if (isRiver(x, y)) {
          const shimmer = Math.sin(g.time * 40 + x * 2 + y) * 8;
          ctx.fillStyle = `rgb(${52 + shimmer}, ${118 + shimmer}, ${160 + shimmer})`;
          this.diamond(sx, sy);
          ctx.fill();
          const hw = this.tw / 2, hh = this.th / 2;
          // Sandy banks along both shores.
          ctx.strokeStyle = 'rgba(214, 198, 156, 0.85)';
          ctx.lineWidth = 2.6 * this.scale;
          ctx.beginPath();
          ctx.moveTo(sx, sy - hh); ctx.lineTo(sx + hw, sy);
          ctx.moveTo(sx - hw, sy); ctx.lineTo(sx, sy + hh);
          ctx.stroke();
          // Flow streaks drifting downstream.
          for (let i = 0; i < 2; i++) {
            const fq = ((g.time * 18 + hash(x + i, y) * 9) % 1);
            ctx.strokeStyle = `rgba(230, 245, 255, ${0.35 * Math.sin(fq * Math.PI)})`;
            ctx.lineWidth = 1;
            const fy = sy - hh * 0.5 + fq * hh;
            ctx.beginPath();
            ctx.moveTo(sx - hw * 0.3, fy);
            ctx.lineTo(sx + hw * 0.15, fy + hh * 0.2);
            ctx.stroke();
          }
          // The occasional duck paddling along.
          if (hash(x, y + 40) < 0.25) {
            const dq = ((g.time * 6 + hash(x, y) * 5) % 1);
            const dxp = sx - hw * 0.3 + dq * hw * 0.6;
            const dyp = sy + (hash(y, x + 2) - 0.5) * hh * 0.5;
            ctx.fillStyle = '#f5f0e0';
            ctx.beginPath();
            ctx.ellipse(dxp, dyp, 2.2 * this.scale, 1.4 * this.scale, 0, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = '#e8a53a';
            ctx.fillRect(dxp + 1.8 * this.scale, dyp - 1.5, 1.4, 1);
          }
        } else {
          // Sunny district-tinted grass with soft blending and mottle texture.
          const r = hash(x, y);
          const shade = r * 10 - 4;
          const tintOf = (d) => {
            if (d === 'oldtown') return [104, 124, 76];
            if (d === 'westside') return [96, 118, 88];
            if (d === 'riverside') return [90, 130, 80];
            return [106, 112, 94];
          };
          // Blend with neighbors so district borders don't cut hard lines.
          let base = tintOf(district.id).slice();
          for (const [nx2, ny2] of [[x + 1, y], [x, y + 1], [x - 1, y], [x, y - 1]]) {
            const nd = this.districtOf(Math.max(0, Math.min(GRID - 1, nx2)), Math.max(0, Math.min(GRID - 1, ny2)));
            const nt = tintOf(nd.id);
            base = [base[0] + nt[0] * 0.25, base[1] + nt[1] * 0.25, base[2] + nt[2] * 0.25];
          }
          base = [base[0] / 2, base[1] / 2, base[2] / 2];
          const sid = this.game.season?.().id;
          if (sid === 'summer') base = [base[0] + 14, base[1] + 4, base[2] - 8];
          else if (sid === 'fall') base = [base[0] + 26, base[1] - 2, base[2] - 18];
          else if (sid === 'winter') {
            base = [
              base[0] * 0.38 + 216 * 0.62,
              base[1] * 0.38 + 221 * 0.62,
              base[2] * 0.38 + 230 * 0.62,
            ];
          }
          // Rolling terrain tone from smooth noise.
          const tn = (vnoise(x * 0.34, y * 0.34) - 0.5) * 22;
          ctx.fillStyle = `rgb(${base[0] + shade + tn}, ${base[1] + shade + tn}, ${base[2] + shade + tn * 0.8})`;
          this.diamond(sx, sy);
          ctx.fill();
          // Mottled grass patches break up the tile grid.
          if (sid !== 'winter') {
            for (let i = 0; i < 3; i++) {
              const hx = hash(x + i * 31, y + i * 17);
              const hy = hash(y + i * 13, x + i * 7);
              ctx.fillStyle = i % 2 === 0
                ? `rgba(255, 255, 220, ${0.05 + hx * 0.05})`
                : `rgba(30, 60, 20, ${0.05 + hy * 0.05})`;
              ctx.beginPath();
              ctx.ellipse(
                sx + (hx - 0.5) * this.tw * 0.7,
                sy + (hy - 0.5) * this.th * 0.6,
                this.tw * (0.08 + hx * 0.10), this.th * (0.10 + hy * 0.12),
                0, 0, Math.PI * 2,
              );
              ctx.fill();
            }
          }
          // Occasional flower patches liven the lots.
          if (r >= 0.44 && r < 0.50 && !locked && sid !== 'winter') {
            const colors = ['#f0a8b8', '#f8d888', '#b8d0f8'];
            for (let i = 0; i < 4; i++) {
              ctx.fillStyle = colors[(Math.floor(r * 100) + i) % 3];
              ctx.fillRect(
                sx + (hash(x + i, y) - 0.5) * this.tw * 0.5,
                sy + (hash(x, y + i) - 0.5) * this.th * 0.5,
                2, 2,
              );
            }
          }
        }
        if (locked) {
          ctx.fillStyle = 'rgba(140, 146, 158, 0.30)';
          this.diamond(sx, sy);
          ctx.fill();
          ctx.fillStyle = 'rgba(20, 24, 32, 0.14)';
          this.diamond(sx, sy);
          ctx.fill();
        }
      }
    }

    // Truck exhaust puffs (ground-level, before buildings).
    for (const p of this.puffs) {
      const { sx, sy } = this.toScreen(p.x, p.y);
      const t = p.age / 1.1;
      ctx.fillStyle = `rgba(190, 195, 205, ${0.25 * (1 - t)})`;
      ctx.beginPath();
      ctx.arc(sx, sy - 4 - t * 8, 2 + t * 5, 0, Math.PI * 2);
      ctx.fill();
    }


  }

  drawRiverTile(x, y) {
    const ctx = this.ctx;
    const g = this.game;
    const { sx, sy } = this.toScreen(x, y);
    const shimmer = Math.sin(g.time * 40 + x * 2 + y) * 8;
    ctx.fillStyle = `rgb(${52 + shimmer}, ${118 + shimmer}, ${160 + shimmer})`;
    this.diamond(sx, sy);
    ctx.fill();
    // Depth: darker channel down the middle.
    ctx.fillStyle = 'rgba(18, 52, 88, 0.45)';
    this.diamond(sx, sy, 0.55);
    ctx.fill();
    // Specular band sliding with the sun.
    const spec = Math.sin(g.time * 26 + y * 1.7) * 0.5 + 0.5;
    ctx.fillStyle = `rgba(255, 250, 230, ${0.10 + spec * 0.14})`;
    ctx.beginPath();
    ctx.ellipse(sx + (spec - 0.5) * this.tw * 0.3, sy, this.tw * 0.22, this.th * 0.10, 0, 0, Math.PI * 2);
    ctx.fill();
    const hw = this.tw / 2, hh = this.th / 2;
    ctx.strokeStyle = 'rgba(214, 198, 156, 0.85)';
    ctx.lineWidth = 2.6 * this.scale;
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh); ctx.lineTo(sx + hw, sy);
    ctx.moveTo(sx - hw, sy); ctx.lineTo(sx, sy + hh);
    ctx.stroke();
    // Lapping foam at the banks.
    const foam = ((g.time * 12 + hash(x, y) * 4) % 1);
    ctx.strokeStyle = `rgba(240, 250, 255, ${0.5 * Math.sin(foam * Math.PI)})`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(sx - hw * (0.9 - foam * 0.1), sy + hh * 0.06);
    ctx.lineTo(sx - hw * 0.15, sy + hh * (0.82 - foam * 0.1));
    ctx.stroke();
    for (let i = 0; i < 2; i++) {
      const fq = ((g.time * 18 + hash(x + i, y) * 9) % 1);
      ctx.strokeStyle = `rgba(230, 245, 255, ${0.35 * Math.sin(fq * Math.PI)})`;
      ctx.lineWidth = 1;
      const fy = sy - hh * 0.5 + fq * hh;
      ctx.beginPath();
      ctx.moveTo(sx - hw * 0.3, fy);
      ctx.lineTo(sx + hw * 0.15, fy + hh * 0.2);
      ctx.stroke();
    }
    if (hash(x, y + 40) < 0.25) {
      const dq = ((g.time * 6 + hash(x, y) * 5) % 1);
      const dxp = sx - hw * 0.3 + dq * hw * 0.6;
      const dyp = sy + (hash(y, x + 2) - 0.5) * hh * 0.5;
      ctx.fillStyle = '#f5f0e0';
      ctx.beginPath();
      ctx.ellipse(dxp, dyp, 2.2 * this.scale, 1.4 * this.scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8a53a';
      ctx.fillRect(dxp + 1.8 * this.scale, dyp - 1.5, 1.4, 1);
    }
  }

  // The static ground is expensive (mottle, seams, blending) — cache it and
  // rebuild only when zoom, season, or district unlocks change.
  ensureGroundCache() {
    const g = this.game;
    const key = [
      this.scale.toFixed(4),
      g.season?.().id ?? 'x',
      DISTRICTS.map((d) => (g.districtUnlocked(d.id) ? 1 : 0)).join(''),
    ].join('|');
    if (this.groundKey === key && this.groundCache) return;
    this.groundKey = key;
    const margin = this.tw;
    const wpx = Math.ceil(GRID * this.tw + margin * 2);
    const hpx = Math.ceil(GRID * this.th + margin * 2);
    const dpr = window.devicePixelRatio || 1;
    this.groundCache = document.createElement('canvas');
    this.groundCache.width = Math.max(1, Math.round(wpx * dpr));
    this.groundCache.height = Math.max(1, Math.round(hpx * dpr));
    const cctx = this.groundCache.getContext('2d');
    cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.groundOx = wpx / 2;
    this.groundOy = margin;
    this.groundCssW = wpx;
    this.groundCssH = hpx;
    const saved = [this.ctx, this.originX, this.originY];
    this.ctx = cctx;
    this.originX = this.groundOx;
    this.originY = this.groundOy;
    this.paintGround();
    [this.ctx, this.originX, this.originY] = saved;
  }

  // Lit windows & signs punch through the night overlay.
  drawLights(drawables, dark) {
    const ctx = this.ctx;
    const g = this.game;
    const glow = Math.min(1, dark * 2.2);
    for (const d of drawables) {
      if (d.kind === 'house' && hash(d.x + 7, d.y + 3) < 0.6) {
        const { sx, sy } = this.toScreen(d.x, d.y);
        const n = 1 + Math.floor(hash(d.x + 1, d.y + 5) * 3);
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = `rgba(255, 214, 130, ${0.75 * glow})`;
          ctx.fillRect(sx - 6 + i * 6 + hash(d.x, d.y + i) * 3, sy - (8 + d.r * 12) * this.scale, 2.4, 2.4);
        }
      } else if (d.kind === 'site') {
        const { sx, sy } = this.toScreen(d.x, d.y);
        if (g.storeAt(d.site.id)) {
          const sg2 = ctx.createRadialGradient(sx, sy - 6, 2, sx, sy - 6, this.tw * 0.8);
          sg2.addColorStop(0, `rgba(255, 210, 130, ${0.30 * glow})`);
          sg2.addColorStop(1, 'rgba(255, 210, 130, 0)');
          ctx.fillStyle = sg2;
          ctx.beginPath();
          ctx.ellipse(sx, sy - 4, this.tw * 0.8, this.th * 0.7, 0, 0, Math.PI * 2);
          ctx.fill();
          // Lit signboard and glowing shopfront windows.
          ctx.fillStyle = `rgba(255, 228, 160, ${0.55 * glow})`;
          const signW = 26 * this.scale + 8;
          ctx.fillRect(sx - signW / 2, sy - 22 * this.scale - 13, signW, 11);
          ctx.fillStyle = `rgba(255, 240, 190, ${0.6 * glow})`;
          const hw2 = (this.tw / 2) * 0.85;
          ctx.fillRect(sx - hw2 * 0.48, sy - 12 * this.scale, hw2 * 0.34, 5 * this.scale);
          ctx.fillRect(sx + hw2 * 0.14, sy - 12 * this.scale, hw2 * 0.34, 5 * this.scale);
        } else if (g.rivalAt(d.site.id)) {
          ctx.fillStyle = `rgba(240, 90, 80, ${0.12 * glow})`;
          this.diamond(sx, sy, 1.15);
          ctx.fill();
        }
      } else if (d.kind === 'warehouse') {
        const { sx, sy } = this.toScreen(d.x, d.y);
        ctx.fillStyle = `rgba(180, 210, 255, ${0.12 * glow})`;
        this.diamond(sx, sy, 1.3);
        ctx.fill();
      } else if (d.kind === 'car') {
        const { sx, sy } = this.toScreen(d.fx, d.fy);
        const c = d.car;
        const u = this.isoUnit(c.horizontal ? c.dir : 0, c.horizontal ? 0 : c.dir);
        const L = this.tw * 0.12;
        ctx.fillStyle = `rgba(255, 240, 200, ${0.9 * glow})`;
        ctx.fillRect(sx + u.x * L - 1.2, sy - 3.5 * this.scale + u.y * L - 1.2, 2.4, 2.4);
      } else if (d.kind === 'truck') {
        const { sx, sy } = this.toScreen(d.fx, d.fy);
        const u = this.isoUnit(d.dx, d.dy);
        ctx.fillStyle = `rgba(255, 240, 200, ${0.9 * glow})`;
        ctx.fillRect(sx + u.x * this.tw * 0.2 - 1.3, sy - 5 * this.scale + u.y * this.tw * 0.2 - 1.3, 2.6, 2.6);
      } else if (d.kind === 'lamp') {
        const { sx, sy } = this.toScreen(d.fx, d.fy);
        const hgt = 14 * this.scale;
        ctx.fillStyle = `rgba(255, 233, 168, ${0.85 * glow})`;
        ctx.beginPath();
        ctx.arc(sx + 4.6 * this.scale, sy - hgt - 2.4 * this.scale, 2.2 * this.scale + 0.6, 0, Math.PI * 2);
        ctx.fill();
        const pool = ctx.createRadialGradient(
          sx + 4.6 * this.scale, sy + 1, 1,
          sx + 4.6 * this.scale, sy + 1, 16 * this.scale);
        pool.addColorStop(0, `rgba(255, 230, 160, ${0.22 * glow})`);
        pool.addColorStop(1, 'rgba(255, 230, 160, 0)');
        ctx.fillStyle = pool;
        ctx.beginPath();
        ctx.ellipse(sx + 4.6 * this.scale, sy + 1, 16 * this.scale, 8 * this.scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  drawThing(d, selectedSiteId) {
    const ctx = this.ctx;
    const g = this.game;

    if (d.kind === 'boat') {
      const { sx, sy } = this.toScreen(d.fx, d.fy);
      const u = this.isoUnit(0, 1);
      const p = { x: -u.y, y: u.x };
      // Wake ripples.
      ctx.strokeStyle = 'rgba(220, 240, 255, 0.35)';
      ctx.lineWidth = 1;
      for (const t of [0.5, 0.8]) {
        ctx.beginPath();
        ctx.arc(sx - u.x * this.tw * 0.12 * t * 2, sy - u.y * this.tw * 0.12 * t * 2, 4 * t + 2, 0.4, Math.PI - 0.4);
        ctx.stroke();
      }
      this.quad(sx, sy - 2, u, this.tw * 0.09, p, this.tw * 0.035, '#7a5a3c');
      this.quad(sx, sy - 3.5, u, this.tw * 0.06, p, this.tw * 0.022, '#9a7a55');
      ctx.fillStyle = '#e8d8c0';
      ctx.beginPath();
      ctx.arc(sx, sy - 6, 1.8, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (d.kind === 'tree') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      const s = this.scale;
      const size = 4 + d.r * 6;
      const ox = (d.r - 0.5) * this.tw * 0.4;
      const sway = Math.sin(g.time * 25 + d.r * 40) * 1.3;
      const species = hash(d.x + 21, d.y + 33);
      ctx.fillStyle = 'rgba(10, 14, 22, 0.22)';
      ctx.beginPath();
      ctx.ellipse(sx + ox + 3, sy + 1, size * s * 1.0, size * s * 0.4, -0.3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#5a4636';
      ctx.fillRect(sx + ox - 1, sy - 6 * s, 2, 6 * s);
      const cx = sx + ox + sway;
      const sid = g.season?.().id;
      // Per-tree autumn hue variation; snow-flocked in winter.
      let deep = '#3f6b45', mid = '#549459', hi = '#6fae67';
      if (sid === 'fall') {
        const hue = hash(d.x, d.y + 60);
        deep = hue < 0.33 ? '#8a4a24' : hue < 0.66 ? '#9a6a20' : '#7a3a2a';
        mid = hue < 0.33 ? '#c07636' : hue < 0.66 ? '#cf9430' : '#b05838';
        hi = hue < 0.33 ? '#e09a50' : hue < 0.66 ? '#e8b848' : '#cf7850';
      } else if (sid === 'winter') { deep = '#8794a0'; mid = '#dde6ee'; hi = '#f2f6fa'; }
      else if (sid === 'summer') { deep = '#33613c'; mid = '#4b8a50'; hi = '#63a45e'; }

      if (species < 0.28) {
        // Pine: stacked shaded triangles.
        for (let i = 0; i < 3; i++) {
          const py = sy - (5 + i * 4.5) * s;
          const pw2 = (5.5 - i * 1.3) * s;
          ctx.fillStyle = i === 2 ? hi : i === 1 ? mid : deep;
          ctx.beginPath();
          ctx.moveTo(cx - pw2, py);
          ctx.lineTo(cx, py - 6 * s);
          ctx.lineTo(cx + pw2, py);
          ctx.closePath();
          ctx.fill();
        }
      } else if (species < 0.42) {
        // Poplar: tall slim column.
        ctx.fillStyle = deep;
        ctx.beginPath();
        ctx.ellipse(cx, sy - (10 + size * 0.6) * s, size * s * 0.5, size * s * 1.7, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = mid;
        ctx.beginPath();
        ctx.ellipse(cx - size * s * 0.12, sy - (11 + size * 0.6) * s, size * s * 0.32, size * s * 1.3, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        // Broadleaf: clustered blobs with per-blob shading.
        const cy = sy - (8 + size) * s;
        const blobs = [
          [0, 0, 1.0, deep], [-0.5, -0.25, 0.62, mid], [0.45, -0.2, 0.58, mid],
          [-0.1, -0.5, 0.5, hi],
        ];
        for (const [bx, by, bs, bc] of blobs) {
          ctx.fillStyle = bc;
          ctx.beginPath();
          ctx.ellipse(cx + bx * size * s, cy + by * size * s, size * s * bs, size * s * bs * 1.05, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      return;
    }

    if (d.kind === 'clocktower') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      const h = 46;
      this.castShadow(sx, sy, h, 0.5);
      this.box(sx, sy, h, '#c9b8a0', '#94856f', '#af9e86', 0.42);
      // Clock face + hands.
      const cy = sy - (h - 7) * this.scale;
      ctx.fillStyle = '#f4efe2';
      ctx.beginPath();
      ctx.arc(sx, cy, 4.6 * this.scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#3a3430';
      ctx.lineWidth = 1;
      const frac = g.dayFrac() * 2 * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(sx, cy);
      ctx.lineTo(sx + Math.sin(frac) * 3.4 * this.scale, cy - Math.cos(frac) * 3.4 * this.scale);
      ctx.moveTo(sx, cy);
      ctx.lineTo(sx + Math.sin(frac / 12) * 2.2 * this.scale, cy - Math.cos(frac / 12) * 2.2 * this.scale);
      ctx.stroke();
      // Pyramid cap.
      ctx.fillStyle = '#7a5648';
      ctx.beginPath();
      ctx.moveTo(sx - 6 * this.scale, sy - h * this.scale);
      ctx.lineTo(sx, sy - (h + 10) * this.scale);
      ctx.lineTo(sx + 6 * this.scale, sy - h * this.scale);
      ctx.closePath();
      ctx.fill();
      return;
    }

    if (d.kind === 'watertower') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      this.castShadow(sx, sy, 30, 0.5);
      // Legs.
      ctx.strokeStyle = '#6a6258';
      ctx.lineWidth = 1.8;
      for (const lx of [-6, 6]) {
        ctx.beginPath();
        ctx.moveTo(sx + lx * this.scale, sy);
        ctx.lineTo(sx + lx * 0.5 * this.scale, sy - 20 * this.scale);
        ctx.stroke();
      }
      // Tank.
      ctx.fillStyle = '#a8ccd8';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 26 * this.scale, 9 * this.scale, 8 * this.scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#8ab4c4';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 23 * this.scale, 9 * this.scale, 4 * this.scale, 0, 0, Math.PI);
      ctx.fill();
      ctx.fillStyle = '#7a94a0';
      ctx.beginPath();
      ctx.moveTo(sx - 9 * this.scale, sy - 27 * this.scale);
      ctx.lineTo(sx, sy - 35 * this.scale);
      ctx.lineTo(sx + 9 * this.scale, sy - 27 * this.scale);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#38424c';
      ctx.font = `700 ${5 * this.scale + 2}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('WESTSIDE', sx, sy - 25 * this.scale);
      return;
    }

    if (d.kind === 'pier') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      // Planked boardwalk reaching west over the water.
      const u = this.isoUnit(-1, 0);
      const p = { x: -u.y, y: u.x };
      this.quad(sx + u.x * this.tw * 0.5, sy + u.y * this.tw * 0.5 - 2, u, this.tw * 0.62, p, this.tw * 0.09, '#9a7a55');
      ctx.strokeStyle = 'rgba(60, 44, 28, 0.5)';
      ctx.lineWidth = 1;
      for (let i = -4; i <= 4; i++) {
        const bx = sx + u.x * this.tw * (0.5 + i * 0.12);
        const by = sy + u.y * this.tw * (0.5 + i * 0.12) - 2;
        ctx.beginPath();
        ctx.moveTo(bx - p.x * this.tw * 0.09, by - p.y * this.tw * 0.09);
        ctx.lineTo(bx + p.x * this.tw * 0.09, by + p.y * this.tw * 0.09);
        ctx.stroke();
      }
      // Moored boats bobbing beside it.
      for (const side of [-1, 1]) {
        const bob = Math.sin(g.time * 30 + side) * 0.8;
        const bx = sx + u.x * this.tw * 0.85;
        const by = sy + u.y * this.tw * 0.85 + side * this.th * 0.22 + bob;
        this.quad(bx, by - 2, u, this.tw * 0.09, p, this.tw * 0.04, side < 0 ? '#c05a4a' : '#4a7ac0');
        this.quad(bx, by - 3.4, u, this.tw * 0.055, p, this.tw * 0.026, '#e8e0d0');
      }
      return;
    }

    if (d.kind === 'glasstower' || d.kind === 'glasstower2') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      const h = d.kind === 'glasstower' ? 52 : 42;
      this.castShadow(sx, sy, h, 0.68);
      this.box(sx, sy, h, '#b8d2e4', '#5a7d99', '#7fa6c2', 0.6);
      // Glass curtain: horizontal floor bands on both faces.
      ctx.strokeStyle = 'rgba(240, 250, 255, 0.30)';
      ctx.lineWidth = 1;
      const hw3 = (this.tw / 2) * 0.6, hh3 = (this.th / 2) * 0.6;
      for (let i = 1; i < Math.floor(h / 5); i++) {
        const fy = sy - i * 5 * this.scale;
        ctx.beginPath();
        ctx.moveTo(sx - hw3, fy);
        ctx.lineTo(sx, fy + hh3);
        ctx.lineTo(sx + hw3, fy);
        ctx.stroke();
      }
      // Rooftop beacon blinks at night.
      if (this.darkness() > 0.1 && Math.floor(performance.now() / 800) % 2 === 0) {
        ctx.fillStyle = '#ff5a5a';
        ctx.beginPath();
        ctx.arc(sx, sy - (h + 4) * this.scale, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    if (d.kind === 'lamp') {
      const { sx, sy } = this.toScreen(d.fx, d.fy);
      const hgt = 14 * this.scale;
      ctx.strokeStyle = '#3c424c';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx, sy - hgt);
      ctx.lineTo(sx + 4 * this.scale, sy - hgt - 2 * this.scale);
      ctx.stroke();
      const lit = this.darkness() > 0.10;
      ctx.fillStyle = lit ? '#ffe9a8' : '#c8ccd4';
      ctx.beginPath();
      ctx.arc(sx + 4.6 * this.scale, sy - hgt - 2.4 * this.scale, 1.8 * this.scale + 0.6, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (d.kind === 'hydrant') {
      const { sx, sy } = this.toScreen(d.fx, d.fy);
      ctx.fillStyle = '#c0483a';
      ctx.fillRect(sx - 1.3, sy - 4 * this.scale, 2.6, 4 * this.scale);
      ctx.beginPath();
      ctx.arc(sx, sy - 4 * this.scale, 1.5, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (d.kind === 'park') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      const winter = g.season?.().id === 'winter';
      // Lawn pad and a cross path.
      ctx.fillStyle = winter ? 'rgba(222, 228, 236, 0.9)' : 'rgba(96, 152, 84, 0.9)';
      this.diamond(sx, sy, 0.95);
      ctx.fill();
      ctx.strokeStyle = 'rgba(196, 186, 160, 0.8)';
      ctx.lineWidth = 2.5 * this.scale;
      ctx.beginPath();
      ctx.moveTo(sx - this.tw * 0.4, sy);
      ctx.lineTo(sx + this.tw * 0.4, sy);
      ctx.moveTo(sx, sy - this.th * 0.4);
      ctx.lineTo(sx, sy + this.th * 0.4);
      ctx.stroke();
      // Fountain: stone ring, water, animated ripple.
      ctx.fillStyle = '#9aa2ac';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 1, 7 * this.scale, 4.5 * this.scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = winter ? '#c8d4e0' : '#4a90b8';
      ctx.beginPath();
      ctx.ellipse(sx, sy - 1, 5 * this.scale, 3 * this.scale, 0, 0, Math.PI * 2);
      ctx.fill();
      if (!winter) {
        const rip = (g.time * 30) % 1;
        ctx.strokeStyle = `rgba(220, 240, 255, ${0.6 * (1 - rip)})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.ellipse(sx, sy - 1, 5 * this.scale * rip, 3 * this.scale * rip, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(220, 240, 255, 0.8)';
        ctx.fillRect(sx - 0.8, sy - 6 * this.scale, 1.6, 4 * this.scale);
      }
      // Benches on two corners.
      ctx.fillStyle = '#8a6a4a';
      ctx.fillRect(sx - this.tw * 0.3 - 3, sy - this.th * 0.22 - 2, 6, 2);
      ctx.fillRect(sx + this.tw * 0.3 - 3, sy + this.th * 0.22 - 2, 6, 2);
      // Corner trees.
      for (const [ox, oy] of [[-0.32, 0.28], [0.32, -0.28]]) {
        const tx = sx + this.tw * ox, ty = sy + this.th * oy;
        ctx.fillStyle = '#4a3c30';
        ctx.fillRect(tx - 1, ty - 5 * this.scale, 2, 5 * this.scale);
        ctx.fillStyle = winter ? '#dde6ee' : '#4e8a54';
        ctx.beginPath();
        ctx.ellipse(tx, ty - 8 * this.scale, 4.5 * this.scale, 5.5 * this.scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      return;
    }

    if (d.kind === 'hedge') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      const winter = g.season?.().id === 'winter';
      // A low clipped hedge row across the lot.
      const u = this.isoUnit(d.r < 0.525 ? 1 : 0, d.r < 0.525 ? 0 : 1);
      const p = { x: -u.y, y: u.x };
      for (let i = -2; i <= 2; i++) {
        const cx = sx + u.x * this.tw * 0.13 * i;
        const cy = sy + u.y * this.tw * 0.13 * i - 3 * this.scale;
        ctx.fillStyle = winter ? '#aeb9c4' : i % 2 ? '#4e7c4a' : '#59894f';
        ctx.beginPath();
        ctx.ellipse(cx, cy, 5 * this.scale, 4 * this.scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      void p;
      return;
    }

    if (d.kind === 'house') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      const tones = HOUSE_TONES[Math.floor(d.r * 17) % HOUSE_TONES.length];
      const apartment = d.r > 0.21;
      const h = apartment ? 15 + d.r * 15 : 8 + d.r * 8;
      const footprint = apartment ? 0.62 : 0.5 + d.r * 0.15;
      const winter = g.season?.().id === 'winter';

      // Driveway to the nearest road.
      const door = this.doorOf(d.x, d.y);
      if (door && !apartment && hash(d.x + 3, d.y + 9) < 0.6) {
        const dw = this.toScreen((d.x + door.x) / 2, (d.y + door.y) / 2);
        ctx.fillStyle = 'rgba(150, 155, 163, 0.55)';
        this.diamond(dw.sx, dw.sy, 0.26);
        ctx.fill();
      }

      this.castShadow(sx, sy, h, footprint);
      this.box(sx, sy, h, tones[0], tones[1], tones[2], footprint);

      if (!apartment) {
        // Gabled roof: two sloped faces meeting at a ridge.
        const roof = winter ? '#e6ebf2' : ROOF_TONES[Math.floor(d.r * 37) % ROOF_TONES.length];
        const roofDark = winter ? '#c8d2de' : shade(roof, -26);
        const hw = (this.tw / 2) * footprint * 0.92;
        const hh = (this.th / 2) * footprint * 0.92;
        const baseY = sy - h * this.scale;
        const ridge = 6 * this.scale + footprint * 4 * this.scale;
        // Four roof faces meeting at a ridge point above the center.
        ctx.fillStyle = roof;
        ctx.beginPath();
        ctx.moveTo(sx - hw, baseY);
        ctx.lineTo(sx, baseY + hh);
        ctx.lineTo(sx, baseY - ridge);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = roofDark;
        ctx.beginPath();
        ctx.moveTo(sx + hw, baseY);
        ctx.lineTo(sx, baseY + hh);
        ctx.lineTo(sx, baseY - ridge);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = roofDark;
        ctx.beginPath();
        ctx.moveTo(sx - hw, baseY);
        ctx.lineTo(sx, baseY - hh);
        ctx.lineTo(sx, baseY - ridge);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = roof;
        ctx.beginPath();
        ctx.moveTo(sx + hw, baseY);
        ctx.lineTo(sx, baseY - hh);
        ctx.lineTo(sx, baseY - ridge);
        ctx.closePath();
        ctx.fill();
        // Chimney on some houses.
        if (hash(d.x + 5, d.y + 5) < 0.45) {
          ctx.fillStyle = '#7a5a4a';
          ctx.fillRect(sx + hw * 0.35 - 1.5, baseY - ridge - 5 * this.scale, 3, 6 * this.scale);
          ctx.fillStyle = '#5c4438';
          ctx.fillRect(sx + hw * 0.35 - 2, baseY - ridge - 5 * this.scale - 1.5, 4, 1.8);
        }
        // Door and a window on the front face.
        ctx.fillStyle = 'rgba(40, 32, 26, 0.75)';
        ctx.fillRect(sx - hw * 0.35 - 1.5, sy - 6.5 * this.scale, 3.2, 6 * this.scale);
        ctx.fillStyle = winter || hash(d.x, d.y + 1) < 0.5 ? 'rgba(250, 240, 200, 0.8)' : 'rgba(180, 205, 225, 0.75)';
        ctx.fillRect(sx + hw * 0.18, sy - 6 * this.scale, 4, 3.2);
      } else {
        // Flat parapet roof + window grids on both faces.
        ctx.fillStyle = 'rgba(255, 255, 255, 0.10)';
        this.diamond(sx, sy - (h + 1) * this.scale, footprint * 0.85);
        ctx.fill();
        const rows = Math.floor(h / 6);
        for (let i = 1; i <= rows; i++) {
          const wy = sy - i * 5.4 * this.scale - 2;
          const lit = hash(d.x + i, d.y) < 0.4;
          ctx.fillStyle = lit ? 'rgba(205, 220, 235, 0.65)' : 'rgba(30, 36, 46, 0.55)';
          ctx.fillRect(sx - 8 * this.scale, wy, 3, 2.2);
          ctx.fillRect(sx - 3 * this.scale, wy, 3, 2.2);
          ctx.fillRect(sx + 3 * this.scale, wy, 3, 2.2);
        }
        // Rooftop: water tower on some, AC unit on others.
        const roofY = sy - h * this.scale;
        if (hash(d.x + 8, d.y + 2) < 0.3) {
          ctx.fillStyle = '#8a7360';
          ctx.fillRect(sx - 2.5, roofY - 8 * this.scale, 5, 6 * this.scale);
          ctx.fillStyle = '#6d5a4a';
          ctx.beginPath();
          ctx.moveTo(sx - 3.5, roofY - 8 * this.scale);
          ctx.lineTo(sx, roofY - 11 * this.scale);
          ctx.lineTo(sx + 3.5, roofY - 8 * this.scale);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = 'rgba(0,0,0,0.4)';
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          ctx.moveTo(sx - 2, roofY - 2 * this.scale);
          ctx.lineTo(sx - 3, roofY);
          ctx.moveTo(sx + 2, roofY - 2 * this.scale);
          ctx.lineTo(sx + 3, roofY);
          ctx.stroke();
        } else if (hash(d.x + 8, d.y + 2) < 0.6) {
          ctx.fillStyle = '#9aa4ae';
          ctx.fillRect(sx + 3, roofY - 3 * this.scale, 5, 3 * this.scale);
        }
      }
      return;
    }

    if (d.kind === 'warehouse') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      // Fenced industrial yard with cargo containers.
      ctx.fillStyle = 'rgba(128, 132, 140, 0.5)';
      this.diamond(sx, sy, 1.45);
      ctx.fill();
      ctx.strokeStyle = 'rgba(90, 96, 106, 0.9)';
      ctx.lineWidth = 1.2;
      this.diamond(sx, sy, 1.45);
      ctx.stroke();
      for (const [ox, oy, cc] of [[-0.85, 0.25, '#b06a4a'], [-0.7, 0.45, '#4a7ab0'], [0.8, -0.35, '#6a9a5a']]) {
        this.box(sx + this.tw * ox * 0.7, sy + this.th * oy * 1.6, 6, cc, shade(cc, -40), shade(cc, -20), 0.22);
      }
      this.castShadow(sx, sy, 26, 1.0);
      // Loading dock apron toward the road, with pallets.
      const door = this.doorOf(d.x, d.y);
      if (door) {
        const ds = this.toScreen((d.x + door.x) / 2, (d.y + door.y) / 2);
        ctx.fillStyle = '#3c434e';
        this.diamond(ds.sx, ds.sy, 0.45);
        ctx.fill();
        ctx.fillStyle = '#a8845a';
        ctx.fillRect(ds.sx - 6, ds.sy - 3, 4, 3);
        ctx.fillRect(ds.sx + 2, ds.sy - 1, 4, 3);
      }
      this.box(sx, sy, 26, '#4a5f7d', '#33425a', '#3d4f6b', 0.95);
      // Roof vents and a skylight strip.
      this.box(sx - this.tw * 0.16, sy - 26 * this.scale, 4, '#6a7f9d', '#4a5a72', '#586a84', 0.14);
      this.box(sx + this.tw * 0.10, sy - 26 * this.scale, 4, '#6a7f9d', '#4a5a72', '#586a84', 0.14);
      ctx.fillStyle = 'rgba(200, 225, 250, 0.25)';
      this.diamond(sx + this.tw * 0.0, sy - 26 * this.scale, 0.30);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.font = `700 ${10 * this.scale + 3}px system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillText('WAREHOUSE', sx + 1, sy - 26 * this.scale - 7);
      ctx.fillStyle = '#cfe0f5';
      ctx.fillText('WAREHOUSE', sx, sy - 26 * this.scale - 8);
      const fill = g.warehouseUsed() / g.warehouse.cap;
      this.bar(sx, sy - 26 * this.scale + 8, fill, fill > 0.92 ? '#e8828c' : '#9ec7ef');
      return;
    }

    if (d.kind === 'truck') {
      const { sx, sy } = this.toScreen(d.fx, d.fy);
      const u = this.isoUnit(d.dx, d.dy);
      const p = { x: -u.y, y: u.x };
      // Ground shadow.
      ctx.fillStyle = 'rgba(0,0,0,0.32)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + 2, this.tw * 0.22, this.tw * 0.09, Math.atan2(u.y, u.x), 0, Math.PI * 2);
      ctx.fill();
      const cy = sy - 5 * this.scale;
      // Trailer box with company stripe, cab up front.
      this.quad(sx - u.x * this.tw * 0.06, cy + 1, u, this.tw * 0.18, p, this.tw * 0.095, 'rgba(22, 26, 34, 0.45)');
      this.quad(sx - u.x * this.tw * 0.06, cy, u, this.tw * 0.17, p, this.tw * 0.085, '#ded9cc');
      this.quad(sx - u.x * this.tw * 0.06, cy - 3.5, u, this.tw * 0.17, p, this.tw * 0.07, '#f4f1e8');
      this.quad(sx - u.x * this.tw * 0.06, cy + 1.5, u, this.tw * 0.16, p, this.tw * 0.02, '#f2c14e');
      this.quad(sx + u.x * this.tw * 0.165, cy + 1, u, this.tw * 0.06, p, this.tw * 0.075, '#5a80a8');
      this.quad(sx + u.x * this.tw * 0.20, cy - 0.5, u, this.tw * 0.02, p, this.tw * 0.065, 'rgba(190,215,235,0.9)');
      // Unloading: crates hop from the tailgate into the store.
      if (d.unloading) {
        const site = g.site(d.storeId);
        if (site) {
          const st = this.toScreen(site.x, site.y);
          const anim = (performance.now() / 650) % 1;
          for (const off of [0, 0.5]) {
            const q = (anim + off) % 1;
            const cx2 = sx + (st.sx - sx) * q;
            const cy2 = sy + (st.sy - 10 * this.scale - sy) * q - Math.sin(q * Math.PI) * 11;
            ctx.fillStyle = '#b08a5a';
            ctx.fillRect(cx2 - 2.5, cy2 - 2.5, 5, 5);
            ctx.strokeStyle = 'rgba(60, 40, 20, 0.6)';
            ctx.lineWidth = 1;
            ctx.strokeRect(cx2 - 2.5, cy2 - 2.5, 5, 5);
          }
          // Hazard blinker while parked.
          if (Math.floor(performance.now() / 400) % 2 === 0) {
            ctx.fillStyle = '#f2a13a';
            ctx.fillRect(sx - u.x * this.tw * 0.23 - 1.5, cy - 1, 3, 3);
          }
        }
      }
      return;
    }

    if (d.kind === 'car') {
      const { sx, sy } = this.toScreen(d.fx, d.fy);
      const c = d.car;
      const u = this.isoUnit(c.horizontal ? c.dir : 0, c.horizontal ? 0 : c.dir);
      const p = { x: -u.y, y: u.x };
      const van = c.type === 'van';
      const L = this.tw * (van ? 0.135 : 0.115);
      const W = this.tw * (van ? 0.055 : 0.045);
      ctx.fillStyle = 'rgba(0,0,0,0.30)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + 1.5, L * 1.1, W * 1.6, Math.atan2(u.y, u.x), 0, Math.PI * 2);
      ctx.fill();
      const bob = Math.sin(performance.now() / 90 + c.line * 3) * 0.4;
      const cy = sy - (van ? 4.5 : 3.5) * this.scale + bob;
      this.quad(sx, cy + 0.8, u, L * 1.06, p, W * 1.15, 'rgba(22, 26, 34, 0.45)');
      this.quad(sx, cy, u, L, p, W, c.color);
      this.quad(sx - u.x * L * 0.15, cy - 2.2, u, L * (van ? 0.6 : 0.45), p, W * 0.8,
        shade(c.color, -40));
      this.quad(sx + u.x * L * 0.62, cy - 1, u, L * 0.14, p, W * 0.85, 'rgba(190, 215, 235, 0.85)');
      ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
      ctx.fillRect(sx + u.x * L * 0.5 - 1, cy - 2.2, 2, 1);
      if (c.type === 'taxi') {
        ctx.fillStyle = '#222';
        ctx.fillRect(sx - 1.5, cy - 4.5, 3, 2);
      }
      return;
    }

    if (d.kind === 'walker') {
      const { sx, sy } = this.toScreen(d.fx, d.fy);
      const bob = Math.sin(d.w.age * 14) * 0.7;
      ctx.fillStyle = 'rgba(10, 14, 22, 0.25)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + 0.5, 2.2 * this.scale, 1 * this.scale, 0, 0, Math.PI * 2);
      ctx.fill();
      // Body capsule + head, in outfit + skin-ish tones.
      ctx.fillStyle = d.w.color;
      ctx.beginPath();
      ctx.ellipse(sx, sy - 3.2 * this.scale - bob, 1.5 * this.scale, 2.6 * this.scale, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#e8c8a8';
      ctx.beginPath();
      ctx.arc(sx, sy - 6.6 * this.scale - bob, 1.3 * this.scale, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Store site.
    const site = d.site;
    const { sx, sy } = this.toScreen(d.x, d.y);
    const store = g.storeAt(site.id);
    const unlocked = g.districtUnlocked(site.district);

    if (g.rivalAt(site.id)) {
      // Big-box discounter: wide flat warehouse-store with a red fascia.
      const plus = g.rival.plus?.[site.id];
      const h = plus ? 20 : 15;
      ctx.fillStyle = 'rgba(105, 110, 120, 0.75)';
      this.diamond(sx + this.tw * 0.18, sy + this.th * 0.22, 0.55);
      ctx.fill();
      this.castShadow(sx, sy, h, plus ? 1.02 : 0.95);
      this.box(sx, sy, h, '#b9bcc2', '#83868e', '#9da0a8', plus ? 0.98 : 0.9);
      // Red fascia band + entrance.
      const hw2 = (this.tw / 2) * (plus ? 0.98 : 0.9);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(sx - hw2 * 0.6, sy - h * this.scale + 1.5, hw2 * 1.2, 4);
      ctx.fillStyle = 'rgba(30, 34, 40, 0.8)';
      ctx.fillRect(sx - hw2 * 0.12, sy - 8 * this.scale, hw2 * 0.24, 7 * this.scale);
      ctx.fillStyle = '#fff0ee';
      ctx.textAlign = 'center';
      ctx.font = `800 ${7.5 * this.scale + 3}px system-ui, sans-serif`;
      ctx.fillText(RIVAL.name.toUpperCase() + (plus ? '+' : ''), sx, sy - h * this.scale - 4);
      return;
    }

    if (!store) {
      ctx.globalAlpha = unlocked ? 0.85 : 0.35;
      this.box(sx, sy, 12, '#565e6c', '#3d434e', '#484f5c', 0.72);
      ctx.textAlign = 'center';
      ctx.font = `700 ${9 * this.scale + 3}px system-ui, sans-serif`;
      ctx.fillStyle = unlocked ? '#f2c14e' : '#8b96a6';
      ctx.fillText(unlocked ? 'FOR SALE' : '—', sx, sy - 12 * this.scale - 4);
      ctx.globalAlpha = 1;
      return;
    }

    // Owned store: green grocer with awning stripes, shopfront, and sign.
    this.castShadow(sx, sy, 22, 0.92);
    this.box(sx, sy, 22, '#588a62', '#3a5a41', '#47704f', 0.85);
    const hw = (this.tw / 2) * 0.85;
    // Striped awning.
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#eee9dd' : '#c95f52';
      ctx.fillRect(sx - hw * 0.55 + i * (hw * 1.1 / 5), sy - 22 * this.scale + 2, hw * 1.1 / 5, 3.5);
    }
    // Shop windows + door under the awning.
    ctx.fillStyle = 'rgba(232, 242, 218, 0.8)';
    ctx.fillRect(sx - hw * 0.48, sy - 12 * this.scale, hw * 0.34, 5 * this.scale);
    ctx.fillRect(sx + hw * 0.14, sy - 12 * this.scale, hw * 0.34, 5 * this.scale);
    ctx.fillStyle = 'rgba(26, 34, 26, 0.85)';
    ctx.fillRect(sx - hw * 0.09, sy - 12 * this.scale, hw * 0.18, 9 * this.scale);
    // Rooftop signboard with the store number.
    const num = (store.name.match(/#(\d+)/) || [])[1] || '';
    const signW = 26 * this.scale + 8;
    ctx.fillStyle = '#2e4a35';
    ctx.fillRect(sx - signW / 2, sy - 22 * this.scale - 13, signW, 11);
    ctx.strokeStyle = '#f2c14e';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx - signW / 2, sy - 22 * this.scale - 13, signW, 11);
    ctx.textAlign = 'center';
    ctx.font = `700 ${7 * this.scale + 2}px system-ui, sans-serif`;
    ctx.fillStyle = '#f5efdf';
    ctx.fillText(`MARKET #${num}`, sx, sy - 22 * this.scale - 4.5);

    const totalInv = PROD_IDS.reduce((s, p) => s + (store.range[p] ? store.inv[p] : 0), 0);
    const capTotal = SHELF_CAP * Math.max(1, g.rangeCount(store));
    const fill = totalInv / capTotal;
    this.bar(sx, sy + 4, fill, fill > 0.45 ? '#6fd08c' : fill > 0.18 ? '#f2c14e' : '#e8828c');

    if (selectedSiteId === site.id) {
      ctx.strokeStyle = '#f2c14e';
      ctx.lineWidth = 2;
      this.diamond(sx, sy, 1.05);
      ctx.stroke();
    }
  }

  bar(sx, sy, fill, color) {
    const ctx = this.ctx;
    const w = 30 * this.scale + 8;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(sx - w / 2, sy, w, 4);
    ctx.fillStyle = color;
    ctx.fillRect(sx - w / 2, sy, w * Math.max(0, Math.min(1, fill)), 4);
  }
}

// Simple hex shade helper for car bodies.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, (n >> 16) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 0xff) + amt));
  const b = Math.max(0, Math.min(255, (n & 0xff) + amt));
  return `rgb(${r}, ${g}, ${b})`;
}
