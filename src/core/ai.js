// The will of the folk. Every day each person weighs their needs, their
// temperament and their grudges, and chooses for themselves. No one is
// given orders — not even by the god watching overhead.

import { tileAt, isPassable, findBestTile, dist, seasonOf } from './world.js';
import {
  isAdult, ageOf, settlementOf, adjustAff, relTo, kill,
} from './character.js';
import { chronicle, remember } from './chronicle.js';
import {
  PROJECTS, foundSettlement, joinSettlement, findSettlementSite, completeProject, membersOf, leaderOf,
} from './settlement.js';
import { socialize, findMatch, court, feudAction, worstEnemy, folkNear, eligible } from './social.js';
import { MONSTER_KINDS, slayMonster } from './monsters.js';
import { resolveRaidIfReady } from './events.js';

const WALK_SPEED = 3;

export function moveToward(sim, p, tx, ty, speed = WALK_SPEED) {
  for (let i = 0; i < speed; i++) {
    const dx = Math.sign(tx - p.x), dy = Math.sign(ty - p.y);
    if (dx === 0 && dy === 0) return true;
    const tries = [[dx, dy], [dx, 0], [0, dy], [dx, dy === 0 ? 1 : -dy], [dx === 0 ? 1 : -dx, dy]];
    let moved = false;
    for (const [mx, my] of tries) {
      if (mx === 0 && my === 0) continue;
      if (isPassable(sim.world, p.x + mx, p.y + my)) { p.x += mx; p.y += my; moved = true; break; }
    }
    if (!moved) return false;
  }
  return p.x === tx && p.y === ty;
}

function nearestMonster(sim, p, maxDist) {
  let best = null, bestD = maxDist + 1;
  for (const m of sim.monsters.values()) {
    const d = dist(p.x, p.y, m.x, m.y);
    if (d < bestD) { bestD = d; best = m; }
  }
  return best;
}

// ---------- The daily decision ----------
export function actDaily(sim, p) {
  if (!p.alive) return;
  const s = settlementOf(sim, p);
  const adult = isAdult(sim, p);
  const ageDays = ageOf(sim, p);
  const season = seasonOf(sim.day);

  // Children shadow their elders: stay near home, eat, play, learn.
  if (!adult) {
    childDay(sim, p, s, ageDays);
    return;
  }

  // A standing multi-day task (raiding, migrating) takes precedence
  // unless survival overrides it.
  if (p.task?.type === 'raid') { doRaidMarch(sim, p); return; }
  if (p.task?.type === 'migrate') { doMigrate(sim, p); return; }

  const threat = nearestMonster(sim, p, 8);
  const foodStock = s ? s.stock.food / Math.max(1, s.members.size) : p.carriedFood;
  const proj = s?.project;
  const enemy = worstEnemy(sim, p, 8);

  const options = [];
  const add = (score, fn, label) => { if (score > 0) options.push({ score, fn, label }); };

  if (threat) {
    const power = MONSTER_KINDS[threat.kind].power;
    const bravery = p.traits.courage + p.skills.fight;
    if (bravery > 0.9 || (bravery > 0.6 && power < 5)) {
      add(6 + bravery * 2, () => doFight(sim, p, threat), 'fighting ' + threat.name);
    } else {
      add(8 - bravery * 3, () => doFlee(sim, p, threat), 'fleeing danger');
    }
  }
  add(p.needs.hunger * 4 + (foodStock < 4 ? (4 - foodStock) : 0) + (season === 'autumn' ? 1 : 0),
    () => doGetFood(sim, p, s), 'finding food');
  if (s) {
    const winterNeed = (season === 'autumn' || season === 'winter') && s.stock.wood < s.members.size * 4;
    const projNeed = proj && !proj.paid;
    if (winterNeed || projNeed) {
      add(2 + (winterNeed ? 2 : 0) + p.traits.diligence * 2,
        () => doGather(sim, p, s, proj), 'gathering materials');
    }
    if (proj?.paid) {
      add(2.5 + p.traits.diligence * 2 + p.skills.build,
        () => doBuild(sim, p, s), `building ${PROJECTS[proj.type].desc}`);
    }
    const sickFolk = membersOf(sim, s).filter(o => o.sick && o.id !== p.id);
    if (sickFolk.length && (p.skills.heal > 0.3 || p.traits.kindness > 0.7)) {
      add(2 + p.traits.kindness * 3 + p.skills.heal * 2,
        () => doTend(sim, p, sickFolk), 'tending the sick');
    }
  }
  add((1 - p.needs.energy) * 3.5 + (p.sick ? 2 : 0) + (p.injured > 0 ? 1.5 : 0),
    () => doRest(sim, p, s), 'resting');
  add((1 - p.needs.social) * 2 + p.traits.kindness, () => doSocialize(sim, p, s), 'keeping company');
  if (eligible(sim, p)) {
    add(1.2 + p.needs.social + (p.mood < 0 ? 0.5 : 0), () => doCourt(sim, p), 'courting');
  }
  if (enemy && relTo(p, enemy.id).aff < -50) {
    add(p.traits.temper * 3 - p.traits.kindness, () => feudAction(sim, p, enemy), 'settling a score');
  }
  add(p.traits.curiosity * 1.2 + (p.mood < -0.3 ? 0.6 : 0), () => doExplore(sim, p), 'wandering');
  if (p.traits.faith > 0.5 && (s?.buildings.temple || sim.faithWitnessed > 0)) {
    add(p.traits.faith * 1.5 + (p.mood < 0 ? 0.5 : 0), () => doPray(sim, p, s), 'praying');
  }

  // Striking out: the ambitious, the exiled and the overcrowded found new homes.
  const crowded = s && s.members.size > 18;
  const leader = s ? leaderOf(sim, s) : null;
  const resentsLeader = leader && leader.id !== p.id && relTo(p, leader.id).aff < -40;
  if (!s) {
    add(5, () => doSeekHome(sim, p), 'seeking a home');
  } else if ((crowded || resentsLeader) && p.traits.ambition > 0.65 && p.traits.courage > 0.4) {
    add(p.traits.ambition * 1.6, () => doFoundSettlement(sim, p, s), 'dreaming of a place of their own');
  }

  if (!options.length) { doRest(sim, p, s); return; }
  options.sort((a, b) => b.score - a.score);
  // A little humanity: not always the optimal choice.
  const pickFrom = options.length > 1 && sim.rng.chance(0.15) ? 1 : 0;
  const choice = options[Math.min(pickFrom, options.length - 1)];
  p.activity = choice.label;
  choice.fn();
}

function childDay(sim, p, s, ageDays) {
  if (s && dist(p.x, p.y, s.x, s.y) > 3) { moveToward(sim, p, s.x, s.y); p.activity = 'heading home'; return; }
  const threat = nearestMonster(sim, p, 6);
  if (threat) { doFlee(sim, p, threat); return; }
  // Older children pitch in and learn.
  if (ageDays > 9 * 96 && sim.rng.chance(0.5)) {
    doGetFood(sim, p, s);
    p.skills.forage = Math.min(1, p.skills.forage + 0.004);
    p.activity = 'helping forage';
  } else {
    socialize(sim, p);
    p.needs.energy = Math.min(1, p.needs.energy + 0.3);
    p.activity = 'playing';
  }
}

// ---------- Actions ----------
function doGetFood(sim, p, s) {
  const homeX = s ? s.x : p.x, homeY = s ? s.y : p.y;
  // Farms first, in season.
  if (s && s.buildings.farm > 0 && seasonOf(sim.day) !== 'winter') {
    if (dist(p.x, p.y, s.x, s.y) > 2) { moveToward(sim, p, s.x, s.y); return; }
    const yieldAmt = (1.5 + p.skills.farm * 2.5) * Math.min(s.buildings.farm, 3);
    s.stock.food += yieldAmt;
    p.skills.farm = Math.min(1, p.skills.farm + 0.005);
    p.needs.energy -= 0.1;
    return;
  }
  // Hunt if skilled and bold.
  if (p.skills.hunt + p.traits.courage > 1.1 && sim.rng.chance(0.4)) {
    const success = sim.rng.chance(0.35 + p.skills.hunt * 0.5);
    p.skills.hunt = Math.min(1, p.skills.hunt + 0.006);
    if (success) {
      const meat = sim.rng.range(3, 7);
      deposit(sim, p, s, meat);
    } else if (sim.rng.chance(0.06)) {
      p.injured += 5; p.health -= 0.15;
      remember(p, sim, 'was gored on a hunt gone wrong');
    }
    return;
  }
  // Forage the best tile within reach.
  const target = findBestTile(sim.world, p.x, p.y, 7, (t, d) =>
    t.food > 1 ? t.food - d * 0.4 : 0);
  if (!target) {
    // Nothing nearby: range farther afield.
    moveToward(sim, p, p.x + sim.rng.int(-8, 8), p.y + sim.rng.int(-8, 8));
    return;
  }
  if (p.x !== target.x || p.y !== target.y) {
    moveToward(sim, p, target.x, target.y);
  }
  const here = tileAt(sim.world, p.x, p.y);
  if (here && here.food > 0) {
    const take = Math.min(here.food, 1.5 + p.skills.forage * 2);
    here.food -= take;
    p.skills.forage = Math.min(1, p.skills.forage + 0.004);
    deposit(sim, p, s, take);
  }
}

function deposit(sim, p, s, amount) {
  // Keep a little for the road, share the rest.
  const keep = Math.min(amount, Math.max(0, 3 - p.carriedFood));
  p.carriedFood += keep;
  if (s) s.stock.food += amount - keep;
  else p.carriedFood += (amount - keep) * 0.5; // no granary, food spoils
}

function doGather(sim, p, s, proj) {
  const cost = proj && !proj.paid ? PROJECTS[proj.type] : null;
  const needStone = cost && s.stock.stone < cost.stone;
  const kind = needStone ? 'stone' : 'wood';
  const target = findBestTile(sim.world, p.x, p.y, 9, (t, d) =>
    (kind === 'stone' ? t.stone : t.wood) > 2 ? (kind === 'stone' ? t.stone : t.wood) - d * 0.5 : 0);
  if (!target) return;
  if (p.x !== target.x || p.y !== target.y) {
    // Stone lies in the mountains' skirts — gather from adjacent tiles.
    moveToward(sim, p, target.x, target.y);
    if (dist(p.x, p.y, target.x, target.y) > 1) return;
  }
  const t = target;
  const take = Math.min(kind === 'stone' ? t.stone : t.wood, 2 + p.traits.diligence * 2);
  if (kind === 'stone') { t.stone -= take; s.stock.stone += take; }
  else { t.wood -= take; s.stock.wood += take; }
  p.needs.energy -= 0.1;
}

function doBuild(sim, p, s) {
  if (dist(p.x, p.y, s.x, s.y) > 2) { moveToward(sim, p, s.x, s.y); return; }
  const work = 1 + p.skills.build * 1.5;
  s.project.workLeft -= work;
  p.skills.build = Math.min(1, p.skills.build + 0.006);
  p.needs.energy -= 0.12;
  if (s.project.workLeft <= 0) {
    completeProject(sim, s);
    p.mood += 0.1;
    p.fame += 0.2;
  }
}

function doRest(sim, p, s) {
  if (s && dist(p.x, p.y, s.x, s.y) > 3) { moveToward(sim, p, s.x, s.y); }
  p.needs.energy = Math.min(1, p.needs.energy + 0.5);
  p.mood += 0.01;
}

function doSocialize(sim, p, s) {
  if (!socialize(sim, p)) {
    if (s) moveToward(sim, p, s.x, s.y);
    else doExplore(sim, p);
  }
}

function doCourt(sim, p) {
  const match = findMatch(sim, p);
  if (!match) { doSocialize(sim, p, settlementOf(sim, p)); return; }
  if (dist(p.x, p.y, match.x, match.y) > 2) { moveToward(sim, p, match.x, match.y); return; }
  court(sim, p, match);
}

function doTend(sim, p, sickFolk) {
  const patient = sickFolk[0];
  if (dist(p.x, p.y, patient.x, patient.y) > 2) { moveToward(sim, p, patient.x, patient.y); return; }
  patient.tendedToday = true;
  patient.health = Math.min(1, patient.health + p.skills.heal * 0.05);
  p.skills.heal = Math.min(1, p.skills.heal + 0.008);
  adjustAff(patient, p.id, 8);
  adjustAff(p, patient.id, 3);
  p.mood += 0.03;
}

function doFight(sim, p, m) {
  if (dist(p.x, p.y, m.x, m.y) > 1) { moveToward(sim, p, m.x, m.y); return; }
  const attack = (p.skills.fight * 3 + p.traits.courage) * sim.rng.range(0.6, 1.4);
  const allies = folkNear(sim, p, 2).filter(o => o.traits.courage > 0.5);
  const total = attack + allies.length * 0.8;
  m.hp -= total;
  p.skills.fight = Math.min(1, p.skills.fight + 0.01);
  if (m.hp <= 0) {
    slayMonster(sim, m, p, allies);
  } else if (sim.rng.chance(0.3)) {
    const bite = m.power * sim.rng.range(0.1, 0.35);
    p.health -= bite / 10;
    p.injured += 3;
    if (p.health <= 0) kill(sim, p, 'beast', { monster: m });
  }
}

function doFlee(sim, p, m) {
  const s = settlementOf(sim, p);
  if (s) moveToward(sim, p, s.x, s.y, 4);
  else moveToward(sim, p, p.x + Math.sign(p.x - m.x) * 6, p.y + Math.sign(p.y - m.y) * 6, 4);
  p.mood -= 0.03;
}

function doExplore(sim, p) {
  moveToward(sim, p, p.x + sim.rng.int(-10, 10), p.y + sim.rng.int(-10, 10));
  p.needs.energy -= 0.08;
  if (sim.rng.chance(0.1)) p.mood += 0.05;
  p.skills.forage = Math.min(1, p.skills.forage + 0.001);
}

function doPray(sim, p, s) {
  if (s?.buildings.temple && dist(p.x, p.y, s.x, s.y) > 2) { moveToward(sim, p, s.x, s.y); return; }
  p.prayedToday = true;
  p.mood += 0.03;
  const devotion = p.traits.faith * (s?.buildings.temple ? 2 : 1);
  sim.faith += 0.15 * devotion;
}

function doSeekHome(sim, p) {
  // Join the nearest settlement that doesn't despise you; otherwise found one.
  let best = null, bestD = 40;
  for (const s of sim.settlements.values()) {
    if (s.members.size === 0 || s.members.size > 24) continue;
    const d = dist(p.x, p.y, s.x, s.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  if (best) {
    let hated = 0;
    for (const o of membersOf(sim, best)) {
      if (o.rel.get(p.id)?.aff < -30) hated++;
    }
    if (hated < 3) {
      if (dist(p.x, p.y, best.x, best.y) > 2) { moveToward(sim, p, best.x, best.y); return; }
      joinSettlement(sim, p, best);
      remember(p, sim, `found a home in ${best.name}`, 0.2);
      return;
    }
  }
  doFoundSettlement(sim, p, null);
}

function doFoundSettlement(sim, p, oldHome) {
  const site = findSettlementSite(sim, p.x, p.y);
  if (!site) { doExplore(sim, p); return; }
  p.task = { type: 'migrate', x: site.x, y: site.y, from: oldHome?.id ?? null };
  // Kith and kin may follow.
  if (oldHome) {
    for (const o of membersOf(sim, oldHome)) {
      if (o.id === p.id || o.task) continue;
      const bond = relTo(o, p.id).aff;
      const kin = o.rel.get(p.id)?.kin;
      if ((bond > 40 || kin === 'spouse' || (kin === 'child' && !isAdult(sim, o))) && sim.rng.chance(0.7)) {
        o.task = { type: 'migrate', x: site.x, y: site.y, follow: p.id };
      }
    }
  }
}

function doMigrate(sim, p) {
  const t = p.task;
  p.activity = 'journeying to a new home';
  const arrived = moveToward(sim, p, t.x, t.y, 4);
  if (!arrived && dist(p.x, p.y, t.x, t.y) > 2) return;
  p.task = null;
  // Someone may have founded it just ahead of us.
  for (const s of sim.settlements.values()) {
    if (s.members.size > 0 && dist(s.x, s.y, t.x, t.y) <= 4) {
      joinSettlement(sim, p, s);
      return;
    }
  }
  const s = foundSettlement(sim, t.x, t.y, p);
  p.fame += 1;
  p.mood += 0.3;
}

function doRaidMarch(sim, p) {
  const t = p.task;
  const target = sim.settlements.get(t.target);
  if (!target || target.members.size === 0) { p.task = null; return; }
  p.activity = `marching on ${target.name}`;
  moveToward(sim, p, target.x, target.y, 4);
  if (dist(p.x, p.y, target.x, target.y) <= 2) {
    resolveRaidIfReady(sim, t.target, t.from);
  }
}
