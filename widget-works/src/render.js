// Isometric canvas renderer.

import { TILE_W, TILE_H, GRID, DX, DY, GOODS, RECIPES, BUILDINGS } from './defs.js';

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.originX = 0;
    this.originY = 0;
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
    this.originX = this.w / 2;
    this.originY = (this.h - GRID * TILE_H) / 2 + TILE_H;
  }

  // Grid coords -> screen position of the tile's center.
  toScreen(x, y) {
    return {
      sx: this.originX + (x - y) * (TILE_W / 2),
      sy: this.originY + (x + y) * (TILE_H / 2),
    };
  }

  // Screen position -> grid coords (may be out of bounds).
  toGrid(sx, sy) {
    const a = (sx - this.originX) / (TILE_W / 2);
    const b = (sy - this.originY) / (TILE_H / 2);
    return { x: Math.floor((a + b) / 2 + 0.5), y: Math.floor((b - a) / 2 + 0.5) };
  }

  diamond(sx, sy, scale = 1) {
    const ctx = this.ctx;
    const hw = (TILE_W / 2) * scale, hh = (TILE_H / 2) * scale;
    ctx.beginPath();
    ctx.moveTo(sx, sy - hh);
    ctx.lineTo(sx + hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx - hw, sy);
    ctx.closePath();
  }

  // A flat-topped iso "box" rising `h` px above the tile.
  box(sx, sy, h, top, left, right, scale = 0.86) {
    const ctx = this.ctx;
    const hw = (TILE_W / 2) * scale, hh = (TILE_H / 2) * scale;
    // left face
    ctx.fillStyle = left;
    ctx.beginPath();
    ctx.moveTo(sx - hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx, sy + hh - h);
    ctx.lineTo(sx - hw, sy - h);
    ctx.closePath();
    ctx.fill();
    // right face
    ctx.fillStyle = right;
    ctx.beginPath();
    ctx.moveTo(sx + hw, sy);
    ctx.lineTo(sx, sy + hh);
    ctx.lineTo(sx, sy + hh - h);
    ctx.lineTo(sx + hw, sy - h);
    ctx.closePath();
    ctx.fill();
    // top
    ctx.fillStyle = top;
    this.diamond(sx, sy - h, scale);
    ctx.fill();
  }

  draw(hover, ghost) {
    const ctx = this.ctx;
    const g = this.game;
    ctx.clearRect(0, 0, this.w, this.h);

    // Ground pass: tiles, belts (flat), items on belts.
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const { sx, sy } = this.toScreen(x, y);
        ctx.fillStyle = (x + y) % 2 === 0 ? '#232a35' : '#1f2630';
        this.diamond(sx, sy);
        ctx.fill();
        ctx.strokeStyle = '#2b3442';
        ctx.lineWidth = 1;
        ctx.stroke();

        const b = g.cell(x, y);
        if (b && b.type === 'belt') this.drawBelt(b, sx, sy);
      }
    }

    // Items ride on top of all belts.
    for (let y = 0; y < GRID; y++) {
      for (let x = 0; x < GRID; x++) {
        const b = g.cell(x, y);
        if (b && b.type === 'belt' && b.item) this.drawItem(b);
      }
    }

    // Tall buildings, back to front.
    const tall = [];
    for (let x = 0; x < GRID; x++) {
      for (let y = 0; y < GRID; y++) {
        const b = g.cell(x, y);
        if (b && b.type !== 'belt') tall.push(b);
      }
    }
    tall.sort((a, b) => (a.x + a.y) - (b.x + b.y));
    for (const b of tall) this.drawBuilding(b);

    // Hover highlight.
    if (hover && g.cell(hover.x, hover.y) !== undefined) {
      const { sx, sy } = this.toScreen(hover.x, hover.y);
      ctx.strokeStyle = 'rgba(242, 193, 78, 0.9)';
      ctx.lineWidth = 2;
      this.diamond(sx, sy);
      ctx.stroke();
    }

    // Placement ghost.
    if (ghost) {
      const { sx, sy } = this.toScreen(ghost.x, ghost.y);
      ctx.globalAlpha = 0.55;
      const ok = g.canPlace(ghost.type, ghost.x, ghost.y);
      if (ghost.type === 'belt') {
        ctx.fillStyle = ok ? '#4a5568' : '#7a3540';
        this.diamond(sx, sy, 0.9);
        ctx.fill();
        this.drawArrow(sx, sy - 2, ghost.dir, ok ? '#dde4ee' : '#e8646f');
      } else {
        const def = BUILDINGS[ghost.type];
        this.box(sx, sy, def.height, ok ? '#5a6b82' : '#8a4450', '#3a4657', '#46536a');
        this.drawArrow(...this.arrowAnchor(sx, sy, def.height), ghost.dir, '#dde4ee');
      }
      ctx.globalAlpha = 1;
    }

    // Floating money texts.
    ctx.textAlign = 'center';
    ctx.font = 'bold 13px system-ui, sans-serif';
    for (const f of g.floaters) {
      const { sx, sy } = this.toScreen(f.x, f.y);
      ctx.globalAlpha = Math.max(0, 1 - f.age / 1.4);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, sx, sy - 30 - f.age * 22);
    }
    ctx.globalAlpha = 1;
  }

  arrowAnchor(sx, sy, h) {
    return [sx, sy - h - 8];
  }

  drawArrow(sx, sy, dir, color) {
    // Arrow along the iso projection of the grid direction.
    const vx = (DX[dir] - DY[dir]) * (TILE_W / 2);
    const vy = (DX[dir] + DY[dir]) * (TILE_H / 2);
    const len = Math.hypot(vx, vy);
    const ux = vx / len, uy = vy / len;
    const px = -uy, py = ux;
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sx - ux * 9, sy - uy * 9);
    ctx.lineTo(sx + ux * 5, sy + uy * 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(sx + ux * 11, sy + uy * 11);
    ctx.lineTo(sx + ux * 3 + px * 4, sy + uy * 3 + py * 4);
    ctx.lineTo(sx + ux * 3 - px * 4, sy + uy * 3 - py * 4);
    ctx.closePath();
    ctx.fill();
  }

  drawBelt(b, sx, sy) {
    const ctx = this.ctx;
    ctx.fillStyle = '#39424f';
    this.diamond(sx, sy, 0.88);
    ctx.fill();
    ctx.strokeStyle = '#2b3240';
    ctx.lineWidth = 1;
    ctx.stroke();
    // Animated chevrons showing flow direction.
    const vx = (DX[b.dir] - DY[b.dir]) * (TILE_W / 2);
    const vy = (DX[b.dir] + DY[b.dir]) * (TILE_H / 2);
    const phase = (this.game.time * 0.9) % 1;
    for (const base of [-0.28, 0.12]) {
      const t = base + phase * 0.4 - 0.2;
      const cx = sx + vx * t, cy = sy + vy * t - 1;
      this.drawChevron(cx, cy, vx, vy, '#5a6678');
    }
  }

  drawChevron(cx, cy, vx, vy, color) {
    const len = Math.hypot(vx, vy);
    const ux = vx / len, uy = vy / len;
    const px = -uy, py = ux;
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx - ux * 4 + px * 5, cy - uy * 4 + py * 5);
    ctx.lineTo(cx + ux * 4, cy + uy * 4);
    ctx.lineTo(cx - ux * 4 - px * 5, cy - uy * 4 - py * 5);
    ctx.stroke();
  }

  drawItem(belt) {
    const { sx, sy } = this.toScreen(belt.x, belt.y);
    const vx = (DX[belt.dir] - DY[belt.dir]) * (TILE_W / 2);
    const vy = (DX[belt.dir] + DY[belt.dir]) * (TILE_H / 2);
    const t = belt.item.progress - 0.5;
    const cx = sx + vx * t, cy = sy + vy * t;
    const ctx = this.ctx;
    ctx.fillStyle = GOODS[belt.item.good].color;
    ctx.beginPath();
    ctx.ellipse(cx, cy - 4, 6, 4.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.35)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  drawBuilding(b) {
    const def = BUILDINGS[b.type];
    const { sx, sy } = this.toScreen(b.x, b.y);
    const ctx = this.ctx;

    if (def.dock) {
      this.box(sx, sy, def.height, '#3f5a45', '#2c4032', '#35503c');
      ctx.fillStyle = '#9fd9a8';
      ctx.font = 'bold 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('$', sx, sy - def.height + 5);
      return;
    }

    if (def.good) {
      const gc = GOODS[def.good].color;
      const dim = b.enabled ? 1 : 0.45;
      ctx.globalAlpha = dim;
      this.box(sx, sy, def.height, '#546073', '#3a4353', '#454f61');
      // Stripe in the good's color on the roof.
      ctx.fillStyle = gc;
      this.diamond(sx, sy - def.height, 0.4);
      ctx.fill();
      ctx.globalAlpha = 1;
      this.drawArrow(...this.arrowAnchor(sx, sy, def.height), b.dir, gc);
      if (!b.enabled) {
        ctx.fillStyle = '#e8646f';
        ctx.font = 'bold 11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('OFF', sx, sy - def.height + 4);
      }
      return;
    }

    if (def.recipe) {
      const recipe = RECIPES[def.recipe];
      const oc = GOODS[recipe.output].color;
      const isFab = b.type === 'fab';
      this.box(
        sx, sy, def.height,
        isFab ? '#6b5a78' : '#5d6b58',
        isFab ? '#4a3e55' : '#414b3e',
        isFab ? '#584a66' : '#4d5a49',
      );
      // Output-good chip on the roof.
      ctx.fillStyle = oc;
      this.diamond(sx, sy - def.height, 0.32);
      ctx.fill();
      // Progress bar.
      if (b.working) {
        const recipeTime = recipe.time;
        const frac = Math.min(1, b.t / recipeTime);
        ctx.fillStyle = 'rgba(0,0,0,0.45)';
        ctx.fillRect(sx - 16, sy - def.height - 12, 32, 5);
        ctx.fillStyle = oc;
        ctx.fillRect(sx - 16, sy - def.height - 12, 32 * frac, 5);
      }
      // Staffing dot: green = staffed, red ring = idle/no worker.
      ctx.beginPath();
      ctx.arc(sx + 18, sy - def.height - 4, 4, 0, Math.PI * 2);
      if (b.worker) {
        ctx.fillStyle = '#6fd08c';
        ctx.fill();
      } else {
        ctx.strokeStyle = '#e8646f';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      this.drawArrow(...this.arrowAnchor(sx, sy, def.height + 10), b.dir, oc);
      return;
    }
  }
}
