// Isometric city renderer: roads, districts, stores, warehouse, trucks.

import {
  TILE_W, TILE_H, GRID, isRoad, WAREHOUSE, PRODUCTS, DISTRICTS, SITES, SHELF_CAP,
} from './defs.js';

const PROD_IDS = Object.keys(PRODUCTS);

// Deterministic per-tile hash for decorative buildings.
function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
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
    // Fit the whole city in view.
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

  districtOf(x, y) {
    return DISTRICTS.find((d) => {
      const [x0, y0, x1, y1] = d.rect;
      return x >= x0 && x < x1 && y >= y0 && y < y1;
    });
  }

  draw(hover, selectedSiteId) {
    const ctx = this.ctx;
    const g = this.game;
    ctx.clearRect(0, 0, this.w, this.h);

    // Ground pass.
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const { sx, sy } = this.toScreen(x, y);
        const locked = !g.districtUnlocked(this.districtOf(x, y).id);
        if (isRoad(x, y)) {
          ctx.fillStyle = locked ? '#20242b' : '#2c313a';
        } else {
          const shade = hash(x, y) * 0.05;
          ctx.fillStyle = locked
            ? `rgba(28, 36, 30, 1)`
            : `rgb(${36 + shade * 60}, ${46 + shade * 60}, ${38 + shade * 40})`;
        }
        this.diamond(sx, sy);
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }

    // Sorted pass: decorative houses, sites, warehouse, trucks.
    const drawables = [];
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        if (isRoad(x, y)) continue;
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
        if (r < 0.38) drawables.push({ key: x + y, kind: 'house', x, y, r });
      }
    }
    for (const t of g.trucks) {
      if (t.state === 'idle' || !t.path) continue;
      const i = Math.min(t.path.length - 1, Math.floor(t.pos));
      const frac = Math.min(1, t.pos - i);
      const a = t.path[i], b = t.path[Math.min(t.path.length - 1, i + 1)];
      const x = a.x + (b.x - a.x) * frac, y = a.y + (b.y - a.y) * frac;
      drawables.push({ key: x + y + 0.01, kind: 'truck', fx: x, fy: y });
    }
    drawables.sort((a, b) => a.key - b.key);
    for (const d of drawables) this.drawThing(d, selectedSiteId);

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

  drawThing(d, selectedSiteId) {
    const ctx = this.ctx;
    const g = this.game;

    if (d.kind === 'house') {
      const { sx, sy } = this.toScreen(d.x, d.y);
      const locked = !g.districtUnlocked(this.districtOf(d.x, d.y).id);
      const h = 6 + d.r * 10;
      const tone = locked ? 0.5 : 1;
      this.box(sx, sy, h,
        `rgba(74, 82, 96, ${tone})`, `rgba(52, 58, 70, ${tone})`, `rgba(62, 69, 82, ${tone})`,
        0.5 + d.r * 0.2);
      return;
    }

    if (d.kind === 'warehouse') {
      const { sx, sy } = this.toScreen(d.x, d.y);
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
      this.box(sx, sy, 7, '#e8e4da', '#b8b4aa', '#ccc8be', 0.26);
      ctx.fillStyle = '#f2c14e';
      ctx.fillRect(sx - 2, sy - 10 * this.scale, 4, 3);
      return;
    }

    // Store site.
    const site = d.site;
    const { sx, sy } = this.toScreen(d.x, d.y);
    const store = g.storeAt(site.id);
    const unlocked = g.districtUnlocked(site.district);

    if (!store) {
      // For-sale lot.
      ctx.globalAlpha = unlocked ? 0.85 : 0.35;
      this.box(sx, sy, 12, '#565e6c', '#3d434e', '#484f5c', 0.72);
      ctx.textAlign = 'center';
      ctx.font = `700 ${9 * this.scale + 3}px system-ui, sans-serif`;
      ctx.fillStyle = unlocked ? '#f2c14e' : '#8b96a6';
      ctx.fillText(unlocked ? 'FOR SALE' : '—', sx, sy - 12 * this.scale - 4);
      ctx.globalAlpha = 1;
      return;
    }

    // Owned store: green grocer with awning stripe.
    this.box(sx, sy, 20, '#4f7a58', '#37543d', '#42654a', 0.85);
    ctx.fillStyle = '#e8e4da';
    const hw = (this.tw / 2) * 0.85;
    ctx.fillRect(sx - hw * 0.55, sy - 20 * this.scale + 2, hw * 1.1, 3);
    ctx.textAlign = 'center';
    ctx.font = `${9 * this.scale + 4}px system-ui, sans-serif`;
    ctx.fillText('🛒', sx, sy - 20 * this.scale - 5);

    // Stock health bar (total inventory vs shelves).
    const totalInv = PROD_IDS.reduce((s, p) => s + store.inv[p], 0);
    const fill = totalInv / (SHELF_CAP * PROD_IDS.length);
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
