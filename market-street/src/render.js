// Isometric city renderer: roads, districts, buildings, river, day/night,
// ambient traffic and shoppers — plus stores, warehouse, trucks, rivals.

import {
  TILE_W, TILE_H, GRID, isRoad, WAREHOUSE, PRODUCTS, DISTRICTS, SITES,
  SHELF_CAP, RIVAL,
} from './defs.js';

const PROD_IDS = Object.keys(PRODUCTS);
const ROAD_LINES = [0, 4, 8, 12, 16, 20];
const CAR_COLORS = ['#c8cdd6', '#8fa8c8', '#c8a08a', '#9ec09a', '#b0a0c8', '#d6c08a'];
const WALKER_COLORS = ['#e8d8c0', '#c0d8e8', '#e8c0c8', '#c8e8c0', '#d8c8e8'];
const HOUSE_TONES = [
  ['#5a6270', '#3e4450', '#4c525e'],
  ['#6b5f52', '#4a4238', '#5a5045'],
  ['#556270', '#3a4450', '#485460'],
  ['#635a6e', '#453e4e', '#544c5e'],
];

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
    this.scale = Math.min(1, this.w / mapW, this.h / mapH);
    this.tw = TILE_W * this.scale;
    this.th = TILE_H * this.scale;
    this.originX = this.w / 2;
    this.originY = (this.h - GRID * this.th) / 2 + this.th;
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
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(sx - hw, sy); ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx, sy + hh - h); ctx.lineTo(sx - hw, sy - h);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(sx + hw, sy); ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx, sy + hh - h); ctx.lineTo(sx + hw, sy - h);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = top;
    this.diamond(sx, sy - h, scale);
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
  }

  // ---- main draw ---------------------------------------------------------

  draw(hover, selectedSiteId) {
    const ctx = this.ctx;
    const g = this.game;
    this.updateAmbient();
    const dark = this.darkness();
    ctx.clearRect(0, 0, this.w, this.h);

    // Ground pass.
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const { sx, sy } = this.toScreen(x, y);
        const district = this.districtOf(x, y);
        const locked = !g.districtUnlocked(district.id);
        if (isRoad(x, y)) {
          // Sidewalk border with an asphalt roadbed inset into it.
          ctx.fillStyle = locked ? '#242832' : '#3a404b';
          this.diamond(sx, sy);
          ctx.fill();
          ctx.fillStyle = locked ? '#1e222a' : '#262b33';
          this.diamond(sx, sy, 0.80);
          ctx.fill();
          const intersection = x % 4 === 0 && y % 4 === 0;
          if (!locked && !intersection) {
            // Dashed center line along the street.
            const vertical = x % 4 === 0;
            const u = this.isoUnit(vertical ? 0 : 1, vertical ? 1 : 0);
            ctx.strokeStyle = 'rgba(215, 200, 130, 0.35)';
            ctx.lineWidth = 1.2;
            for (const t of [-0.28, 0.08]) {
              ctx.beginPath();
              ctx.moveTo(sx + u.x * this.tw * t, sy + u.y * this.tw * t);
              ctx.lineTo(sx + u.x * this.tw * (t + 0.18), sy + u.y * this.tw * (t + 0.18));
              ctx.stroke();
            }
          } else if (!locked && intersection) {
            // Zebra crosswalks on each approach.
            ctx.strokeStyle = 'rgba(220, 225, 235, 0.25)';
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
          const shimmer = Math.sin(g.time * 40 + x * 2 + y) * 6;
          ctx.fillStyle = `rgb(${26 + shimmer}, ${58 + shimmer}, ${82 + shimmer})`;
          this.diamond(sx, sy);
          ctx.fill();
        } else {
          // District-tinted grass/lot ground with per-tile variation.
          const r = hash(x, y);
          const shade = r * 14 - 4;
          let base;
          if (district.id === 'oldtown') base = [42, 52, 41];
          else if (district.id === 'westside') base = [41, 49, 50];
          else if (district.id === 'riverside') base = [38, 54, 43];
          else base = [45, 47, 52];
          ctx.fillStyle = `rgb(${base[0] + shade}, ${base[1] + shade}, ${base[2] + shade})`;
          this.diamond(sx, sy);
          ctx.fill();
        }
        if (locked) {
          ctx.fillStyle = 'rgba(10, 12, 18, 0.35)';
          this.diamond(sx, sy);
          ctx.fill();
        }
      }
    }

    // World pass: everything with height, painter-sorted.
    const drawables = [];
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
        const r = hash(x, y);
        if (r < 0.30) drawables.push({ key: x + y, kind: 'house', x, y, r });
        else if (r < 0.44) drawables.push({ key: x + y, kind: 'tree', x, y, r });
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
    for (const d of drawables) this.drawThing(d, selectedSiteId, dark);

    // Night overlay, then lights on top so they read as glow.
    if (dark > 0.02) {
      ctx.fillStyle = `rgba(8, 12, 38, ${dark})`;
      ctx.fillRect(0, 0, this.w, this.h);
      if (dark > 0.12) this.drawLights(drawables, dark);
    }

    // District labels.
    ctx.textAlign = 'center';
    for (const d of DISTRICTS) {
      const [x0, y0, x1, y1] = d.rect;
      const { sx, sy } = this.toScreen((x0 + x1) / 2 - 0.5, (y0 + y1) / 2 - 0.5);
      const locked = !g.districtUnlocked(d.id);
      ctx.font = `700 ${13 * this.scale + 4}px system-ui, sans-serif`;
      ctx.fillStyle = locked ? 'rgba(200, 210, 225, 0.5)' : 'rgba(200, 210, 225, 0.22)';
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
          ctx.fillStyle = `rgba(255, 205, 120, ${0.16 * glow})`;
          this.diamond(sx, sy, 1.25);
          ctx.fill();
          ctx.fillStyle = `rgba(255, 228, 160, ${0.85 * glow})`;
          ctx.fillRect(sx - 8, sy - 20 * this.scale + 6, 16, 2.5);
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
      }
    }
  }

  drawThing(d, selectedSiteId, dark) {
    const ctx = this.ctx;
    const g = this.game;

    if (d.kind === 'tree') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      const s = this.scale;
      const size = 4 + d.r * 6;
      const ox = (d.r - 0.5) * this.tw * 0.4;
      ctx.fillStyle = '#4a3c30';
      ctx.fillRect(sx + ox - 1, sy - 6 * s, 2, 6 * s);
      ctx.fillStyle = d.r < 0.41 ? '#3f6b46' : '#4a7a50';
      ctx.beginPath();
      ctx.ellipse(sx + ox, sy - (8 + size) * s, size * s * 1.1, size * s * 1.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.ellipse(sx + ox - size * s * 0.3, sy - (9 + size) * s, size * s * 0.4, size * s * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    if (d.kind === 'house') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      const tones = HOUSE_TONES[Math.floor(d.r * 17) % HOUSE_TONES.length];
      const apartment = d.r > 0.21;
      const h = apartment ? 14 + d.r * 14 : 7 + d.r * 8;
      const footprint = apartment ? 0.62 : 0.5 + d.r * 0.15;
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      this.diamond(sx + 2, sy + 1.5, footprint * 1.04);
      ctx.fill();
      this.box(sx, sy, h, tones[0], tones[1], tones[2], footprint);
      if (!apartment) {
        // Pitched roof: darker cap diamond.
        ctx.fillStyle = d.r < 0.12 ? '#7a4f42' : '#4f4a55';
        this.diamond(sx, sy - (h + 2) * this.scale, footprint * 0.7);
        ctx.fill();
      } else {
        // Window rows on the south face.
        ctx.fillStyle = 'rgba(20, 24, 34, 0.5)';
        const rows = Math.floor(h / 7);
        for (let i = 1; i <= rows; i++) {
          ctx.fillRect(sx - 7, sy - i * 6 * this.scale - 2, 3, 2.2);
          ctx.fillRect(sx + 3, sy - i * 6 * this.scale - 2, 3, 2.2);
        }
      }
      return;
    }

    if (d.kind === 'warehouse') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      this.diamond(sx + 2, sy + 1.5, 1.0);
      ctx.fill();
      this.box(sx, sy, 26, '#4a5f7d', '#33425a', '#3d4f6b', 0.95);
      ctx.textAlign = 'center';
      ctx.font = `700 ${10 * this.scale + 3}px system-ui, sans-serif`;
      ctx.fillStyle = '#cfe0f5';
      ctx.fillText('WAREHOUSE', sx, sy - 26 * this.scale - 4);
      const fill = g.warehouseUsed() / g.warehouse.cap;
      this.bar(sx, sy - 26 * this.scale + 6, fill, fill > 0.92 ? '#e8828c' : '#9ec7ef');
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
      const cy = sy - (van ? 4.5 : 3.5) * this.scale;
      this.quad(sx, cy, u, L, p, W, c.color);
      this.quad(sx - u.x * L * 0.15, cy - 2.2, u, L * (van ? 0.6 : 0.45), p, W * 0.8,
        shade(c.color, -40));
      this.quad(sx + u.x * L * 0.62, cy - 1, u, L * 0.14, p, W * 0.85, 'rgba(190, 215, 235, 0.85)');
      if (c.type === 'taxi') {
        ctx.fillStyle = '#222';
        ctx.fillRect(sx - 1.5, cy - 4.5, 3, 2);
      }
      return;
    }

    if (d.kind === 'walker') {
      const { sx, sy } = this.toScreen(d.fx, d.fy);
      const bob = Math.sin(d.w.age * 14) * 0.8;
      ctx.fillStyle = d.w.color;
      ctx.beginPath();
      ctx.arc(sx, sy - 3 - bob, 1.8 * this.scale + 0.8, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    // Store site.
    const site = d.site;
    const { sx, sy } = this.toScreen(d.x, d.y);
    const store = g.storeAt(site.id);
    const unlocked = g.districtUnlocked(site.district);

    if (g.rivalAt(site.id)) {
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      this.diamond(sx + 2, sy + 1.5, 0.92);
      ctx.fill();
      this.box(sx, sy, 18, '#8a4438', '#5e2d26', '#733830', 0.85);
      ctx.fillStyle = '#f0c4b8';
      ctx.textAlign = 'center';
      ctx.font = `700 ${8 * this.scale + 3}px system-ui, sans-serif`;
      ctx.fillText(RIVAL.name.toUpperCase(), sx, sy - 18 * this.scale - 4);
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

    // Owned store: green grocer with awning stripes and a lit shopfront.
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    this.diamond(sx + 2, sy + 1.5, 0.92);
    ctx.fill();
    this.box(sx, sy, 20, '#4f7a58', '#37543d', '#42654a', 0.85);
    const hw = (this.tw / 2) * 0.85;
    // Striped awning.
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 === 0 ? '#e8e4da' : '#c95f52';
      ctx.fillRect(sx - hw * 0.55 + i * (hw * 1.1 / 5), sy - 20 * this.scale + 2, hw * 1.1 / 5, 3.5);
    }
    // Shop windows + door under the awning.
    ctx.fillStyle = 'rgba(228, 238, 215, 0.75)';
    ctx.fillRect(sx - hw * 0.48, sy - 11 * this.scale, hw * 0.34, 4.5 * this.scale);
    ctx.fillRect(sx + hw * 0.14, sy - 11 * this.scale, hw * 0.34, 4.5 * this.scale);
    ctx.fillStyle = 'rgba(26, 34, 26, 0.85)';
    ctx.fillRect(sx - hw * 0.09, sy - 11 * this.scale, hw * 0.18, 8 * this.scale);
    ctx.textAlign = 'center';
    ctx.font = `${9 * this.scale + 4}px system-ui, sans-serif`;
    ctx.fillText('🛒', sx, sy - 20 * this.scale - 5);

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
