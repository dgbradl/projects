// Settlements: homes the folk build for themselves. They rise, prosper,
// squabble with their neighbors, and sometimes burn.

import { settlementName } from './names.js';
import { chronicle } from './chronicle.js';
import { seasonOf, tileAt, findBestTile } from './world.js';
import { adjustSettlementRelation } from './character.js';

export const PROJECTS = {
  shelter: { wood: 20, stone: 4,  days: 14, desc: 'a shelter' },
  farm:    { wood: 8,  stone: 0,  days: 10, desc: 'a farm' },
  wall:    { wood: 14, stone: 20, days: 20, desc: 'walls' },
  hall:    { wood: 30, stone: 10, days: 24, desc: 'a meeting hall' },
  temple:  { wood: 24, stone: 30, days: 30, desc: 'a temple' },
};

export function foundSettlement(sim, x, y, founder) {
  const s = {
    id: sim.nextId++,
    name: settlementName(sim.rng),
    x, y,
    founderId: founder ? founder.id : null,
    foundedDay: sim.day,
    members: new Set(),
    stock: { food: 10, wood: 10, stone: 0 },
    buildings: { shelter: 1, farm: 0, wall: 0, hall: 0, temple: 0 },
    project: null,               // { type, workLeft, paid }
    relations: new Map(),        // other settlement id -> -100..100
    lastRaidedDay: -9999,
    raidCooldown: 0,
    fallen: false,
  };
  sim.settlements.set(s.id, s);
  if (founder) joinSettlement(sim, founder, s);
  chronicle(sim, 2, founder
    ? `${founder.name} founded the settlement of ${s.name}`
    : `The settlement of ${s.name} was founded`, { x, y, kind: 'founding' });
  return s;
}

export function joinSettlement(sim, p, s) {
  if (p.home !== null) {
    const old = sim.settlements.get(p.home);
    if (old) old.members.delete(p.id);
  }
  p.home = s.id;
  s.members.add(p.id);
}

export function membersOf(sim, s) {
  const out = [];
  for (const id of s.members) {
    const p = sim.folk.get(id);
    if (p && p.alive) out.push(p);
  }
  return out;
}

export function shelterCapacity(s) { return s.buildings.shelter * 5; }

// A settlement's leader: the living member with the most standing.
export function leaderOf(sim, s) {
  let best = null, bestScore = -1;
  for (const p of membersOf(sim, s)) {
    const score = p.traits.ambition * 2 + p.fame + (p.skills.fight + p.skills.build) * 0.5;
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

// Choose what to build next, by communal need. Nobody orders this from above;
// it is what any sensible villager would reach for first.
function chooseProject(sim, s) {
  const pop = s.members.size;
  if (pop === 0) return null;
  const season = seasonOf(sim.day);
  const capacity = shelterCapacity(s);
  const foodPerHead = s.stock.food / pop;
  const recentlyAttacked = sim.day - s.lastRaidedDay < 96;

  const wants = [];
  if (capacity < pop) wants.push(['shelter', 10 + (pop - capacity)]);
  if (s.buildings.farm < Math.ceil(pop / 4) && foodPerHead < 12) wants.push(['farm', 8]);
  if (recentlyAttacked && s.buildings.wall < 2) wants.push(['wall', 9]);
  if (s.buildings.wall < 1 && pop >= 8) wants.push(['wall', 3]);
  if (s.buildings.hall < 1 && pop >= 10) wants.push(['hall', 4]);
  if (s.buildings.temple < 1 && pop >= 12 && sim.faithWitnessed > 2) wants.push(['temple', 5]);
  if (season === 'autumn' && capacity < pop + 2) wants.push(['shelter', 6]);
  if (!wants.length) return null;
  wants.sort((a, b) => b[1] - a[1]);
  return wants[0][0];
}

export function settlementDaily(sim, s) {
  const members = membersOf(sim, s);
  if (members.length === 0) {
    if (!s.fallen) {
      s.fallen = true;
      chronicle(sim, 2, `${s.name} stands empty; its last hearth has gone cold`, { x: s.x, y: s.y, kind: 'fall' });
    }
    return;
  }
  s.fallen = false;

  // Winter fires burn wood.
  if (seasonOf(sim.day) === 'winter') {
    s.stock.wood = Math.max(0, s.stock.wood - Math.max(1, members.length * 0.15));
  }

  // Farms yield food in the growing seasons if someone farmed this year.
  // (Actual farm work handled by folk AI; passive trickle here for tended farms.)

  // Start a project when there is none.
  if (!s.project) {
    const want = chooseProject(sim, s);
    if (want) {
      const cost = PROJECTS[want];
      s.project = { type: want, workLeft: cost.days, paid: false };
    }
  }
  // Pay materials once resources are on hand.
  if (s.project && !s.project.paid) {
    const cost = PROJECTS[s.project.type];
    if (s.stock.wood >= cost.wood && s.stock.stone >= cost.stone) {
      s.stock.wood -= cost.wood;
      s.stock.stone -= cost.stone;
      s.project.paid = true;
    }
  }

  // Relations drift: neighbors compete when hungry, mellow when fed.
  if (sim.day % 8 === 0) {
    for (const other of sim.settlements.values()) {
      if (other.id === s.id || other.members.size === 0) continue;
      const d = Math.abs(s.x - other.x) + Math.abs(s.y - other.y);
      if (d > 60) continue;
      const cur = s.relations.get(other.id) ?? 0;
      const foodPressure = (s.stock.food / Math.max(1, s.members.size)) < 3;
      let drift = cur * -0.02;                       // slow regression to neutral
      if (foodPressure && d < 30) drift -= 1.2;      // hungry neighbors covet
      if (s.buildings.hall && other.buildings.hall) drift += 0.3;
      adjustSettlementRelation(s, other, drift);
    }
  }
  if (s.raidCooldown > 0) s.raidCooldown--;
}

export function completeProject(sim, s) {
  const proj = s.project;
  if (!proj) return;
  s.buildings[proj.type] = (s.buildings[proj.type] || 0) + 1;
  s.project = null;
  chronicle(sim, 1, `${s.name} finished building ${PROJECTS[proj.type].desc}`, { x: s.x, y: s.y, kind: 'building' });
}

// Find a good spot to found a new settlement: fertile, near water-ish, far from others.
export function findSettlementSite(sim, nearX, nearY) {
  return findBestTile(sim.world, nearX, nearY, 22, (t, d) => {
    if (t.biome === 'water' || t.biome === 'mountain') return 0;
    if (d < 10) return 0; // strike out on your own, properly
    let s = t.fertility * 10 - d * 0.08;
    for (const other of sim.settlements.values()) {
      if (other.members.size === 0) continue;
      const od = Math.abs(t.x - other.x) + Math.abs(t.y - other.y);
      if (od < 14) return 0;
      if (od < 24) s -= 3;
    }
    return s;
  });
}
