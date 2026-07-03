// The simulation loop: one tick is one day in the vale. The god (player)
// watches; the folk live, love, build, feud, and die on their own.

import { makeRng } from './rng.js';
import { generateWorld, regrowTiles, seasonOf, yearOf, DAYS_PER_YEAR, findBestTile, BIOME } from './world.js';
import { makePerson, metabolize, isAdult, grantEpithet } from './character.js';
import { settlementDaily } from './settlement.js';
import { seedHerds, herdsDaily } from './herds.js';
import { actDaily } from './ai.js';
import { monsterDaily } from './monsters.js';
import { worldEvents } from './events.js';
import { tryConceive, gestate } from './social.js';
import { religionDaily } from './religion.js';
import { chronicle } from './chronicle.js';

export const WORLD_W = 110;
export const WORLD_H = 72;

export function createSim(seed) {
  const rng = makeRng(seed);
  const sim = {
    seed,
    rng,
    day: 0,
    world: generateWorld(rng, WORLD_W, WORLD_H),
    folk: new Map(),
    settlements: new Map(),
    monsters: new Map(),
    herds: new Map(),
    religions: new Map(),
    shrines: new Map(),
    obituaries: [],           // the dead endure in the record even when pruned
    godDeeds: { mercy: 0, wrath: 0 },   // what the folk have seen you do
    lastDeedDay: -9999,
    popHistory: [],
    chronicleLog: [],
    onChronicle: null,
    nextId: 1,
    faith: 60,
    faithWitnessed: 0,
    weather: { rainDays: 0, storm: false, drought: false },
    plague: { active: false, daysLeft: 0 },
    livingCount: 0,
    peakPopulation: 0,
    totalBorn: 0,
    totalDied: 0,
    extinct: false,
    yearStats: { born: 0, died: 0 },
  };

  seedTheVale(sim);
  seedHerds(sim);
  return sim;
}

// The founding generation: a band of settlers arrives with nothing but each
// other. Where they go from here is up to them.
function seedTheVale(sim) {
  const site = findBestTile(sim.world, Math.floor(WORLD_W / 2), Math.floor(WORLD_H / 2), 30,
    (t, d) => (t.biome === BIOME.PLAINS || t.biome === BIOME.FOREST) ? t.fertility * 10 - d * 0.05 : 0);
  const cx = site ? site.x : Math.floor(WORLD_W / 2);
  const cy = site ? site.y : Math.floor(WORLD_H / 2);

  const settlers = [];
  for (let i = 0; i < 18; i++) {
    const adult = i < 14;
    const ageYearsVal = adult ? sim.rng.int(16, 38) : sim.rng.int(3, 12);
    const p = makePerson(sim, {
      x: cx + sim.rng.int(-2, 2), y: cy + sim.rng.int(-2, 2),
      bornDay: -ageYearsVal * DAYS_PER_YEAR,
    });
    settlers.push(p);
  }
  // A few arrive already bound to one another.
  for (let i = 0; i + 1 < 6; i += 2) {
    const a = settlers[i], b = settlers[i + 1];
    if (a.sex !== b.sex) {
      a.spouse = b.id; b.spouse = a.id;
      a.rel.set(b.id, { aff: 70, kin: 'spouse' });
      b.rel.set(a.id, { aff: 70, kin: 'spouse' });
    }
  }
  chronicle(sim, 3, `${settlers.length} settlers came over the mountains into an unnamed vale`, { x: cx, y: cy, kind: 'founding' });
}

export function tick(sim) {
  if (sim.extinct) return;
  sim.day++;

  regrowTiles(sim);
  for (const s of sim.settlements.values()) s.farmhands = 0;

  // The living act in shuffled order so no one has a standing advantage.
  const living = [...sim.folk.values()].filter(p => p.alive);
  sim.rng.shuffle(living);
  for (const p of living) {
    p.px = p.x; p.py = p.y;
    metabolize(sim, p);
    if (!p.alive) continue;
    gestate(sim, p);
    if (!p.alive) continue;
    actDaily(sim, p);
    if (p.alive && isAdult(sim, p)) tryConceive(sim, p);
  }

  for (const m of [...sim.monsters.values()]) monsterDaily(sim, m);
  herdsDaily(sim);
  for (const s of sim.settlements.values()) settlementDaily(sim, s);
  worldEvents(sim);
  religionDaily(sim);

  // Passive faith: belief sustains you even when no one prays aloud.
  let believers = 0;
  for (const p of sim.folk.values()) if (p.alive && p.traits.faith > 0.6) believers++;
  sim.faith = Math.min(200, sim.faith + 0.05 + believers * 0.01);

  // Bookkeeping and the turning of years.
  const nowLiving = [...sim.folk.values()].filter(p => p.alive);
  const prevCount = sim.livingCount;
  sim.livingCount = nowLiving.length;
  sim.peakPopulation = Math.max(sim.peakPopulation, sim.livingCount);

  if (sim.day % 4 === 0) {
    sim.popHistory.push(sim.livingCount);
    if (sim.popHistory.length > 2400) sim.popHistory.splice(0, 400); // ~100 years kept
  }

  if (sim.day % DAYS_PER_YEAR === 0) yearSummary(sim, nowLiving);

  if (sim.livingCount === 0 && prevCount > 0) {
    sim.extinct = true;
    chronicle(sim, 3, `The last of the folk is gone. The vale falls silent after ${yearOf(sim.day)} years. Peak population: ${sim.peakPopulation}.`, { kind: 'extinction' });
  }

  // Cull long-dead records' relationships to keep memory bounded.
  if (sim.day % 200 === 0) pruneDead(sim);
}

function yearSummary(sim, living) {
  const year = yearOf(sim.day);
  // Renown accrues; the folk find names for their great ones.
  for (const p of living) {
    if (!p.epithet && p.fame >= 8) grantEpithet(sim, p, 'the Renowned');
  }
  const settlements = [...sim.settlements.values()].filter(s => s.members.size > 0);
  let biggest = null;
  for (const s of settlements) if (!biggest || s.members.size > biggest.members.size) biggest = s;
  chronicle(sim, 2,
    `Year ${year} closed: ${living.length} folk across ${settlements.length} settlement${settlements.length === 1 ? '' : 's'}` +
    (biggest ? `; ${biggest.name} the greatest among them (${biggest.members.size})` : ''),
    { kind: 'year' });
}

function pruneDead(sim) {
  const deadIds = [];
  for (const p of sim.folk.values()) {
    if (!p.alive) {
      p.rel.clear();
      if (sim.day - (p.diedDay ?? sim.day) > DAYS_PER_YEAR * 2) deadIds.push(p.id);
    }
  }
  // Keep the dead in the record (the chronicle references them), just strip
  // their heavy state; only truly ancient dead are dropped.
  for (const id of deadIds) sim.folk.delete(id);
  for (const p of sim.folk.values()) {
    for (const id of [...p.rel.keys()]) {
      const o = sim.folk.get(id);
      if (!o) p.rel.delete(id);
    }
  }
}

// A stable hash of world state, for determinism tests.
export function stateHash(sim) {
  let h = 2166136261;
  const mix = (n) => {
    h ^= Math.round(n * 1000) & 0xffff;
    h = Math.imul(h, 16777619);
  };
  mix(sim.day); mix(sim.livingCount); mix(sim.faith); mix(sim.nextId);
  for (const p of sim.folk.values()) {
    if (!p.alive) continue;
    mix(p.x); mix(p.y); mix(p.health); mix(p.needs.hunger); mix(p.mood);
  }
  for (const s of sim.settlements.values()) {
    mix(s.stock.food); mix(s.stock.wood); mix(s.members.size);
  }
  return h >>> 0;
}
