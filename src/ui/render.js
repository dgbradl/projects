// Canvas renderer: the god's-eye view of the vale.

import { seasonOf, BIOME } from '../core/world.js';

const BIOME_COLORS = {
  [BIOME.WATER]:    [38, 62, 82],
  [BIOME.PLAINS]:   [126, 138, 74],
  [BIOME.FOREST]:   [62, 94, 54],
  [BIOME.SWAMP]:    [72, 84, 60],
  [BIOME.MOUNTAIN]: [110, 102, 94],
  [BIOME.TUNDRA]:   [150, 150, 140],
};

const SETTLEMENT_HUES = [42, 200, 320, 90, 260, 20, 170, 300, 60, 220];

export function makeCamera(canvas, worldW, worldH) {
  return {
    x: worldW / 2, y: worldH / 2,   // world coords at screen center
    zoom: 9,                        // pixels per tile
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

// Transient visual pings (miracles, deaths, battles) fade over ~2 seconds.
export function makeEffects() {
  const list = [];
  return {
    add(x, y, color, big = false) { list.push({ x, y, color, big, t: 1 }); },
    step(dt) {
      for (const e of list) e.t -= dt * 0.5;
      for (let i = list.length - 1; i >= 0; i--) if (list[i].t <= 0) list.splice(i, 1);
    },
    list,
  };
}

export function render(ctx, sim, cam, selection, effects, hoverTile) {
  const { canvas } = cam;
  const z = cam.zoom;
  ctx.fillStyle = '#0c0b09';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const season = seasonOf(sim.day);
  const winter = season === 'winter';

  // Visible tile range
  const [x0, y0] = cam.toWorld(0, 0);
  const [x1, y1] = cam.toWorld(canvas.width, canvas.height);

  for (let ty = Math.max(0, y0); ty <= Math.min(sim.world.h - 1, y1 + 1); ty++) {
    for (let tx = Math.max(0, x0); tx <= Math.min(sim.world.w - 1, x1 + 1); tx++) {
      const t = sim.world.tiles[ty * sim.world.w + tx];
      let [r, g, b] = BIOME_COLORS[t.biome];
      // Subtle deterministic per-tile variation (hashed, so no visible pattern)
      const v = (((tx * 73856093) ^ (ty * 19349663)) % 7 + 7) % 7 - 3;
      r += v * 2; g += v * 2; b += v;
      // Season & state tinting
      if (winter && t.biome !== BIOME.WATER) { r = r * 0.55 + 110; g = g * 0.55 + 112; b = b * 0.55 + 120; }
      if (season === 'autumn' && (t.biome === BIOME.FOREST || t.biome === BIOME.PLAINS)) { r += 26; g -= 6; }
      if (t.blight > 0.05) { r = r * (1 - t.blight * 0.5) + 60 * t.blight; g *= 1 - t.blight * 0.6; b *= 1 - t.blight * 0.4; }
      if (t.bounty > 0.05) { g += t.bounty * 40; r += t.bounty * 10; }
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      const [sx, sy] = cam.toScreen(tx, ty);
      ctx.fillRect(sx, sy, z + 1, z + 1);
    }
  }

  // Settlements: a plaza ring, buildings as marks
  for (const s of sim.settlements.values()) {
    if (s.members.size === 0 && sim.day - s.foundedDay > 500) continue;
    const [sx, sy] = cam.toScreen(s.x + 0.5, s.y + 0.5);
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
    // building marks arranged around center
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
    // name label at moderate zoom
    if (z >= 6 && !dead) {
      ctx.fillStyle = 'rgba(230, 218, 190, 0.85)';
      ctx.font = `${Math.max(10, z * 1.1)}px Georgia`;
      ctx.textAlign = 'center';
      ctx.fillText(s.name, sx, sy - rad - 4);
    }
  }

  // Folk
  for (const p of sim.folk.values()) {
    if (!p.alive) continue;
    const [sx, sy] = cam.toScreen(p.x + 0.5, p.y + 0.5);
    if (sx < -10 || sy < -10 || sx > canvas.width + 10 || sy > canvas.height + 10) continue;
    const s = p.home !== null ? sim.settlements.get(p.home) : null;
    ctx.fillStyle = s ? settlementColor(s) : '#cfc4ae';
    const r = Math.max(1.6, z * 0.28);
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
    const [sx, sy] = cam.toScreen(m.x + 0.5, m.y + 0.5);
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
    if ((selection.kind === 'person' && e.alive) || (selection.kind === 'monster' && sim.monsters.has(e.id))) {
      const [sx, sy] = cam.toScreen(e.x + 0.5, e.y + 0.5);
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
  }

  // Hover tile outline
  if (hoverTile) {
    const [sx, sy] = cam.toScreen(hoverTile[0], hoverTile[1]);
    ctx.strokeStyle = 'rgba(240, 215, 140, 0.5)';
    ctx.lineWidth = 1;
    ctx.strokeRect(sx, sy, z, z);
  }

  // Effects
  for (const e of effects.list) {
    const [sx, sy] = cam.toScreen(e.x + 0.5, e.y + 0.5);
    ctx.strokeStyle = e.color;
    ctx.globalAlpha = Math.max(0, e.t);
    ctx.lineWidth = e.big ? 2.5 : 1.5;
    ctx.beginPath();
    ctx.arc(sx, sy, (1 - e.t) * (e.big ? 46 : 22) + 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // Weather veil
  if (sim.weather.storm) {
    ctx.fillStyle = 'rgba(40, 45, 70, 0.25)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (sim.weather.rainDays > 0) {
    ctx.fillStyle = 'rgba(60, 80, 110, 0.12)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (sim.weather.drought) {
    ctx.fillStyle = 'rgba(150, 110, 30, 0.10)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function drawTriangle(ctx, r, strokeOnly = false) {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.lineTo(r * 0.87, r * 0.6);
  ctx.lineTo(-r * 0.87, r * 0.6);
  ctx.closePath();
  if (strokeOnly) ctx.stroke(); else ctx.fill();
}
