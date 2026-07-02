// The cruelty (and caprice) of the world: plagues, storms, beasts, and the
// wars folk wage on one another.

import { chronicle, remember } from './chronicle.js';
import { seasonOf, yearOf, dist, findBestTile, BIOME } from './world.js';
import { infect, kill, adjustAff, adjustSettlementRelation } from './character.js';
import { membersOf, leaderOf } from './settlement.js';
import { spawnMonster } from './monsters.js';

export function worldEvents(sim) {
  const rng = sim.rng;
  const pop = sim.livingCount;
  const year = yearOf(sim.day);
  const season = seasonOf(sim.day);

  // Weather
  if (sim.weather.rainDays > 0) sim.weather.rainDays--;
  if (sim.weather.storm) sim.weather.storm = false;
  if (rng.chance(0.06) && season !== 'winter') sim.weather.rainDays = rng.int(1, 3);
  if (rng.chance(season === 'summer' ? 0.015 : 0.008)) {
    sim.weather.storm = true;
    if (rng.chance(0.3)) {
      // Storms wreck what stands tallest.
      const victims = [...sim.settlements.values()].filter(s => s.members.size > 0);
      if (victims.length) {
        const s = rng.pick(victims);
        if (s.buildings.shelter > 1 && rng.chance(0.5)) {
          s.buildings.shelter--;
          chronicle(sim, 1, `A storm tore a shelter apart in ${s.name}`, { x: s.x, y: s.y, kind: 'disaster' });
        }
      }
    }
  }
  if (season === 'summer' && rng.chance(0.004)) {
    sim.weather.drought = true;
    chronicle(sim, 2, 'A drought has settled over the land', { kind: 'disaster' });
  }
  if (sim.weather.drought && (season === 'autumn' || rng.chance(0.02))) {
    if (sim.weather.drought) chronicle(sim, 1, 'The drought has broken', { kind: 'weather' });
    sim.weather.drought = false;
  }

  // Beasts multiply where folk thrive (there is more to eat).
  const wolfCount = [...sim.monsters.values()].filter(m => m.kind === 'wolfpack').length;
  if (wolfCount < 1 + Math.floor(pop / 18) && rng.chance(0.02)) {
    const t = wildTile(sim);
    if (t) spawnMonster(sim, 'wolfpack', t.x, t.y, { quiet: wolfCount > 1 });
  }
  if (year >= 3 && rng.chance(0.0035) && ![...sim.monsters.values()].some(m => m.kind === 'troll')) {
    const t = wildTile(sim, BIOME.MOUNTAIN);
    if (t) spawnMonster(sim, 'troll', t.x, t.y);
  }
  if (year >= 8 && pop > 30 && rng.chance(0.0012) && ![...sim.monsters.values()].some(m => m.kind === 'dragon')) {
    const t = wildTile(sim, BIOME.MOUNTAIN);
    if (t) spawnMonster(sim, 'dragon', t.x, t.y);
  }

  // Plague: rare, terrible, and it spreads in close quarters.
  if (!sim.plague.active && pop > 15 && rng.chance(0.0012)) {
    sim.plague.active = true;
    sim.plague.daysLeft = rng.int(24, 48);
    chronicle(sim, 3, 'A plague has come. Folk cough blood and pray.', { kind: 'plague' });
    const unlucky = rng.shuffle([...sim.folk.values()].filter(p => p.alive)).slice(0, 2);
    for (const p of unlucky) infect(sim, p, 'the plague');
  }
  if (sim.plague.active) {
    sim.plague.daysLeft--;
    for (const s of sim.settlements.values()) {
      const members = membersOf(sim, s);
      const sickCount = members.filter(p => p.sick).length;
      if (!sickCount) continue;
      for (const p of members) {
        if (!p.sick && rng.chance(0.02 * sickCount)) infect(sim, p, 'the plague');
      }
    }
    if (sim.plague.daysLeft <= 0) {
      sim.plague.active = false;
      chronicle(sim, 2, 'The plague has burned itself out', { kind: 'plague' });
    }
  }

  warAndRaids(sim);
}

function wildTile(sim, preferBiome = null) {
  // A spot far from every hearth.
  return findBestTile(sim.world, sim.rng.int(5, sim.world.w - 5), sim.rng.int(5, sim.world.h - 5), 20, (t) => {
    if (t.biome === BIOME.WATER) return 0;
    let minD = Infinity;
    for (const s of sim.settlements.values()) {
      if (s.members.size > 0) minD = Math.min(minD, dist(t.x, t.y, s.x, s.y));
    }
    if (minD < 12) return 0;
    return (preferBiome && t.biome === preferBiome ? 5 : 1) + sim.rng.float();
  });
}

// ---------- War between settlements ----------
function warAndRaids(sim) {
  if (sim.day % 6 !== 0) return;
  for (const s of sim.settlements.values()) {
    if (s.members.size < 5 || s.raidCooldown > 0) continue;
    const leader = leaderOf(sim, s);
    if (!leader) continue;
    const desperate = s.stock.food / s.members.size < 2;
    for (const [otherId, rel] of s.relations) {
      const other = sim.settlements.get(otherId);
      if (!other || other.members.size === 0) continue;
      if (rel > -55 && !(desperate && rel < -25)) continue;
      const aggression = leader.traits.temper + leader.traits.ambition - leader.traits.kindness + (desperate ? 0.6 : 0);
      if (!sim.rng.chance(Math.max(0, aggression * 0.15))) continue;
      launchRaid(sim, s, other);
      break;
    }
  }
}

function launchRaid(sim, from, target) {
  const fighters = membersOf(sim, from)
    .filter(p => p.traits.courage > 0.4 && !p.task && !p.sick)
    .sort((a, b) => (b.skills.fight + b.traits.courage) - (a.skills.fight + a.traits.courage))
    .slice(0, Math.min(6, Math.floor(from.members.size / 2)));
  if (fighters.length < 2) return;
  for (const f of fighters) f.task = { type: 'raid', target: target.id, from: from.id };
  from.raidCooldown = 60;
  chronicle(sim, 2, `${from.name} sent ${fighters.length} raiders against ${target.name}`, { x: from.x, y: from.y, kind: 'war' });
}

export function resolveRaidIfReady(sim, targetId, fromId) {
  const target = sim.settlements.get(targetId);
  const from = sim.settlements.get(fromId);
  if (!target || !from) return;
  const raiders = [...sim.folk.values()].filter(p =>
    p.alive && p.task?.type === 'raid' && p.task.target === targetId &&
    dist(p.x, p.y, target.x, target.y) <= 4);
  const enRoute = [...sim.folk.values()].filter(p =>
    p.alive && p.task?.type === 'raid' && p.task.target === targetId &&
    dist(p.x, p.y, target.x, target.y) > 4);
  // Wait for stragglers unless half the band is already at the gates.
  if (enRoute.length > raiders.length) return;
  if (raiders.length === 0) return;

  const defenders = membersOf(sim, target).filter(p =>
    dist(p.x, p.y, target.x, target.y) <= 6 && (p.traits.courage > 0.3 || p.skills.fight > 0.3));

  let atk = 0, def = target.buildings.wall * 4;
  for (const r of raiders) atk += r.skills.fight * 3 + r.traits.courage + 0.5;
  for (const d of defenders) def += d.skills.fight * 3 + d.traits.courage + 0.3;
  atk *= sim.rng.range(0.7, 1.3);
  def *= sim.rng.range(0.7, 1.3);

  const battleDeaths = (side, count) => {
    const pool = sim.rng.shuffle([...side]);
    const dead = [];
    for (let i = 0; i < Math.min(count, pool.length); i++) {
      if (sim.rng.chance(0.6)) dead.push(pool[i]);
      else { pool[i].injured += 8; pool[i].health -= 0.3; }
    }
    return dead;
  };

  if (atk > def) {
    const loot = Math.min(target.stock.food * 0.6, 40);
    target.stock.food -= loot;
    from.stock.food += loot;
    const dead = battleDeaths(defenders, Math.ceil(defenders.length * 0.3));
    const raiderDead = battleDeaths(raiders, Math.ceil(raiders.length * 0.15));
    for (const d of dead) kill(sim, d, 'battle', { killer: raiders[0], blamedSettlement: from.id });
    for (const d of raiderDead) kill(sim, d, 'battle', { killer: defenders[0] ?? null, blamedSettlement: target.id });
    target.lastRaidedDay = sim.day;
    chronicle(sim, 2, `Raiders from ${from.name} sacked ${target.name}, carrying off ${Math.round(loot)} stores`, { x: target.x, y: target.y, kind: 'war' });
    for (const p of membersOf(sim, target)) { p.mood -= 0.25; remember(p, sim, `survived the sack of ${target.name}`); }
    for (const r of raiders) { if (r.alive) { r.mood += 0.1; r.fame += 0.5; } }
  } else {
    const raiderDead = battleDeaths(raiders, Math.ceil(raiders.length * 0.4));
    const defDead = battleDeaths(defenders, Math.ceil(defenders.length * 0.1));
    for (const d of raiderDead) kill(sim, d, 'battle', { killer: defenders[0] ?? null, blamedSettlement: target.id });
    for (const d of defDead) kill(sim, d, 'battle', { killer: raiders[0], blamedSettlement: from.id });
    chronicle(sim, 2, `${target.name} threw back the raiders of ${from.name}`, { x: target.x, y: target.y, kind: 'war' });
    for (const d of defenders) { if (d.alive) { d.mood += 0.15; d.fame += 0.3; } }
  }
  adjustSettlementRelation(from, target, -25);
  // Personal hatred outlives the battle.
  for (const d of membersOf(sim, target)) {
    for (const r of raiders) if (r.alive) adjustAff(d, r.id, -25);
  }
  for (const r of [...raiders, ...enRoute]) if (r.alive) r.task = null;
}
