// Deer herds: the quiet life of the wilds. They graze, multiply in spring,
// and are hunted by wolves and folk alike. While the deer are plentiful the
// wolves leave people be; when the herds thin, hunger turns them bold.

import { tileAt, isPassable, findBestTile, dist, seasonOf, BIOME } from './world.js';

export function spawnHerd(sim, x, y, size) {
  const h = {
    id: sim.nextId++,
    x, y, px: x, py: y,
    size,
  };
  sim.herds.set(h.id, h);
  return h;
}

export function seedHerds(sim) {
  let placed = 0, guard = 0;
  while (placed < 7 && guard++ < 300) {
    const x = sim.rng.int(4, sim.world.w - 5), y = sim.rng.int(4, sim.world.h - 5);
    const t = tileAt(sim.world, x, y);
    if (t && (t.biome === BIOME.PLAINS || t.biome === BIOME.FOREST)) {
      spawnHerd(sim, x, y, sim.rng.int(6, 12));
      placed++;
    }
  }
}

function moveHerd(sim, h, tx, ty, speed) {
  for (let i = 0; i < speed; i++) {
    const dx = Math.sign(tx - h.x), dy = Math.sign(ty - h.y);
    if (dx === 0 && dy === 0) return;
    const tries = [[dx, dy], [dx, 0], [0, dy]];
    let moved = false;
    for (const [mx, my] of tries) {
      if (mx === 0 && my === 0) continue;
      if (isPassable(sim.world, h.x + mx, h.y + my)) { h.x += mx; h.y += my; moved = true; break; }
    }
    if (!moved) return;
  }
}

export function herdDaily(sim, h) {
  h.px = h.x; h.py = h.y;

  // Flight before appetite: wolves and folk both spook the herd.
  let fleeFrom = null;
  for (const m of sim.monsters.values()) {
    if (m.kind === 'wolfpack' && dist(m.x, m.y, h.x, h.y) <= 8) { fleeFrom = m; break; }
  }
  if (!fleeFrom) {
    for (const p of sim.folk.values()) {
      if (p.alive && dist(p.x, p.y, h.x, h.y) <= 3) { fleeFrom = p; break; }
    }
  }
  if (fleeFrom) {
    moveHerd(sim, h, h.x + Math.sign(h.x - fleeFrom.x) * 8, h.y + Math.sign(h.y - fleeFrom.y) * 8, 5);
    return;
  }

  // Graze the richest ground nearby.
  const t = tileAt(sim.world, h.x, h.y);
  if (t && t.food > 1) {
    t.food -= Math.min(t.food - 0.5, h.size * 0.06);
    if (seasonOf(sim.day) === 'spring' && h.size < 14 && sim.rng.chance(0.06)) h.size++;
  } else {
    const best = findBestTile(sim.world, h.x, h.y, 6, (tt, d) => tt.food > 1.5 ? tt.food - d * 0.3 : 0);
    if (best) moveHerd(sim, h, best.x, best.y, 3);
    else {
      moveHerd(sim, h, h.x + sim.rng.int(-5, 5), h.y + sim.rng.int(-5, 5), 3);
      if (sim.rng.chance(0.05)) h.size--; // lean land thins the herd
    }
  }
  if (seasonOf(sim.day) === 'winter' && sim.rng.chance(0.02)) h.size--;
  if (h.size <= 0) sim.herds.delete(h.id);
}

export function herdsDaily(sim) {
  for (const h of [...sim.herds.values()]) herdDaily(sim, h);
  // New herds drift in from beyond the vale when the wilds stand empty.
  if (sim.herds.size < 4 && sim.rng.chance(0.012)) {
    const edge = sim.rng.pick(['n', 's', 'e', 'w']);
    const x = edge === 'e' ? sim.world.w - 4 : edge === 'w' ? 3 : sim.rng.int(4, sim.world.w - 5);
    const y = edge === 's' ? sim.world.h - 4 : edge === 'n' ? 3 : sim.rng.int(4, sim.world.h - 5);
    if (isPassable(sim.world, x, y)) spawnHerd(sim, x, y, sim.rng.int(5, 9));
  }
}

export function nearestHerd(sim, x, y, maxDist) {
  let best = null, bestD = maxDist + 1;
  for (const h of sim.herds.values()) {
    const d = dist(h.x, h.y, x, y);
    if (d < bestD) { bestD = d; best = h; }
  }
  return best;
}

// A predator or hunter takes from the herd. Returns true if a deer was taken.
export function cullHerd(sim, h) {
  if (!sim.herds.has(h.id) || h.size <= 0) return false;
  h.size--;
  if (h.size <= 0) sim.herds.delete(h.id);
  return true;
}
