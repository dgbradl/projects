// World map: procedural biomes, regrowing resources, seasons and weather.

export const BIOME = {
  WATER: 'water', PLAINS: 'plains', FOREST: 'forest',
  SWAMP: 'swamp', MOUNTAIN: 'mountain', TUNDRA: 'tundra',
};

export const DAYS_PER_SEASON = 24;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'];
export const DAYS_PER_YEAR = DAYS_PER_SEASON * SEASONS.length;

export function seasonOf(day) { return SEASONS[Math.floor((day % DAYS_PER_YEAR) / DAYS_PER_SEASON)]; }
export function yearOf(day) { return Math.floor(day / DAYS_PER_YEAR) + 1; }
export function dayOfYear(day) { return (day % DAYS_PER_YEAR) + 1; }

// Smooth value noise: coarse random lattice, bilinear interpolation, 3 octaves.
function noiseGrid(rng, w, h, scale) {
  const gw = Math.ceil(w / scale) + 2, gh = Math.ceil(h / scale) + 2;
  const lattice = new Float32Array(gw * gh);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rng.float();
  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / scale, fy = y / scale;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = smooth(fx - x0), ty = smooth(fy - y0);
    const v = (gx, gy) => lattice[gy * gw + gx];
    const top = v(x0, y0) * (1 - tx) + v(x0 + 1, y0) * tx;
    const bot = v(x0, y0 + 1) * (1 - tx) + v(x0 + 1, y0 + 1) * tx;
    return top * (1 - ty) + bot * ty;
  };
}

function octaves(fns, x, y) {
  let sum = 0, amp = 1, total = 0;
  for (const f of fns) { sum += f(x, y) * amp; total += amp; amp *= 0.5; }
  return sum / total;
}

const BIOME_PROPS = {
  [BIOME.WATER]:    { fertility: 0.0,  wood: 0,   passable: false },
  [BIOME.PLAINS]:   { fertility: 0.9,  wood: 4,   passable: true },
  [BIOME.FOREST]:   { fertility: 0.6,  wood: 30,  passable: true },
  [BIOME.SWAMP]:    { fertility: 0.35, wood: 10,  passable: true },
  [BIOME.MOUNTAIN]: { fertility: 0.08, wood: 2,   passable: false },
  [BIOME.TUNDRA]:   { fertility: 0.25, wood: 6,   passable: true },
};

export function generateWorld(rng, w, h) {
  const elevN = [noiseGrid(rng, w, h, 24), noiseGrid(rng, w, h, 12), noiseGrid(rng, w, h, 6)];
  const moistN = [noiseGrid(rng, w, h, 20), noiseGrid(rng, w, h, 8)];
  const tiles = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y) / Math.min(w, h); // sink map edges
      const elev = octaves(elevN, x, y) * 0.85 + Math.min(edge * 3, 1) * 0.15;
      const moist = octaves(moistN, x, y);
      const cold = 1 - y / h; // north is cold
      let biome;
      if (elev < 0.32) biome = BIOME.WATER;
      else if (elev > 0.74) biome = BIOME.MOUNTAIN;
      else if (cold > 0.8 && elev > 0.35) biome = BIOME.TUNDRA;
      else if (moist > 0.62 && elev < 0.42) biome = BIOME.SWAMP;
      else if (moist > 0.52) biome = BIOME.FOREST;
      else biome = BIOME.PLAINS;
      const p = BIOME_PROPS[biome];
      const fertility = p.fertility * (0.7 + moist * 0.6);
      tiles[y * w + x] = {
        x, y, biome,
        fertility,                       // drives food regrowth
        food: fertility * 6,             // forageable food available now
        maxFood: fertility * 9,
        wood: p.wood * (0.6 + rng.float() * 0.8),
        stone: biome === BIOME.MOUNTAIN ? 60 : (elev > 0.6 ? 18 : 3),
        blight: 0,                       // god-inflicted corruption, 0..1
        bounty: 0,                       // god-granted abundance, 0..1
      };
    }
  }
  return { w, h, tiles };
}

export function tileAt(world, x, y) {
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return null;
  return world.tiles[y * world.w + x];
}

export function isPassable(world, x, y) {
  const t = tileAt(world, x, y);
  return !!t && BIOME_PROPS[t.biome].passable;
}

// Season multiplier on plant growth.
export function growthFactor(season) {
  return { spring: 1.2, summer: 1.0, autumn: 0.6, winter: 0.02 }[season];
}

export function regrowTiles(sim) {
  const season = seasonOf(sim.day);
  const g = growthFactor(season) * (sim.weather.rainDays > 0 ? 1.4 : 1.0) * (sim.weather.drought ? 0.35 : 1.0);
  for (const t of sim.world.tiles) {
    if (t.biome === BIOME.WATER || t.biome === BIOME.MOUNTAIN) continue;
    const cap = t.maxFood * (1 + t.bounty * 1.5) * (1 - t.blight * 0.9);
    const rate = 0.25 * t.fertility * g * (1 + t.bounty) * (1 - t.blight);
    t.food = Math.min(cap, t.food + rate);
    if (t.wood < 30 && t.biome === BIOME.FOREST) t.wood += 0.02;
    t.bounty = Math.max(0, t.bounty - 0.004);
    t.blight = Math.max(0, t.blight - 0.002);
  }
}

// Spiral-ish search for the best nearby tile by score; returns null if none positive.
export function findBestTile(world, cx, cy, radius, score) {
  let best = null, bestScore = 0;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const t = tileAt(world, cx + dx, cy + dy);
      if (!t) continue;
      const dist = Math.abs(dx) + Math.abs(dy);
      const s = score(t, dist);
      if (s > bestScore) { bestScore = s; best = t; }
    }
  }
  return best;
}

export function dist(ax, ay, bx, by) {
  return Math.abs(ax - bx) + Math.abs(ay - by);
}
