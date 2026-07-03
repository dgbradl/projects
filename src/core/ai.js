// The will of the folk. Every day each person weighs their needs, their
// temperament and their grudges, and chooses for themselves. No one is
// given orders — not even by the god watching overhead.

import { tileAt, isPassable, findBestTile, dist, seasonOf } from './world.js';
import {
  isAdult, ageOf, settlementOf, adjustAff, relTo, kill, displayName, adjustSettlementRelation,
} from './character.js';
import { nearestHerd, cullHerd } from './herds.js';
import { doctrineOf, religionOf, godTone } from './religion.js';
import { chronicle, remember } from './chronicle.js';
import {
  PROJECTS, foundSettlement, joinSettlement, findSettlementSite, completeProject, membersOf, chiefOf,
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
      if (isPassable(sim.world, p.x + mx, p.y + my)) {
        p.x += mx; p.y += my; moved = true;
        // Footsteps wear the land: enough of them become a visible path.
        const t = tileAt(sim.world, p.x, p.y);
        if (t) t.traffic = Math.min(30, t.traffic + 1);
        break;
      }
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

  // A standing multi-day task (raiding, migrating, trading) takes precedence
  // unless survival overrides it.
  if (p.task?.type === 'raid') { doRaidMarch(sim, p); return; }
  if (p.task?.type === 'migrate') { doMigrate(sim, p); return; }
  if (p.task?.type === 'trade') { doTradeMarch(sim, p); return; }
  if (p.task?.type === 'goHome') { doGoHome(sim, p); return; }
  if (p.task?.type === 'hunt') { doManhunt(sim, p); return; }
  if (p.task?.type === 'pilgrimage') { doPilgrimage(sim, p); return; }

  // The road turns some folk crooked: long homelessness curdles the
  // bitter-tempered into outlaws.
  if (!s) {
    p.homelessDays = (p.homelessDays ?? 0) + 1;
    if (!p.outlaw && p.homelessDays > 60 && p.traits.kindness < 0.35 && p.traits.temper > 0.55) {
      p.outlaw = true;
      chronicle(sim, 1, `${displayName(p)} turned to banditry`, { x: p.x, y: p.y, kind: 'banditry', who: [p.id] });
      remember(p, sim, 'gave up on honest company and took to the road');
    }
  } else {
    p.homelessDays = 0;
  }
  if (p.outlaw) { outlawDay(sim, p); return; }

  const threat = nearestMonster(sim, p, 8);
  const foodStock = s ? s.stock.food / Math.max(1, s.members.size) : p.carriedFood;
  const proj = s?.project;
  const enemy = worstEnemy(sim, p, 8);
  const doctrine = doctrineOf(sim, p);

  const options = [];
  const add = (score, fn, label) => { if (score > 0) options.push({ score, fn, label }); };

  if (threat) {
    const power = MONSTER_KINDS[threat.kind].power;
    const bravery = p.traits.courage + p.skills.fight + (doctrine === 'wrath' ? 0.3 : 0);
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
    if (sickFolk.length && (p.skills.heal > 0.3 || p.traits.kindness > 0.7 || doctrine === 'mercy')) {
      add(2 + p.traits.kindness * 3 + p.skills.heal * 2 + (doctrine === 'mercy' ? 1 : 0),
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
  if (p.traits.faith > 0.5 && (s?.buildings.temple || sim.faithWitnessed > 0 || p.religion !== null)) {
    add(p.traits.faith * 1.5 + (p.religion !== null ? 0.8 : 0) + (p.mood < 0 ? 0.5 : 0),
      () => doPray(sim, p, s), 'praying');
  }
  // The long walk to holy ground, once every few years.
  if (p.religion !== null && p.traits.faith > 0.65 &&
      sim.day - (p.lastPilgrimage ?? -999) > 96 * 2) {
    let shrine = null;
    for (const sh of sim.shrines.values()) {
      if (sh.religionId === p.religion && dist(p.x, p.y, sh.x, sh.y) > 8) { shrine = sh; break; }
    }
    if (shrine) {
      add(0.8 + p.traits.faith + (p.mood < -0.1 ? 0.7 : 0), () => {
        p.task = { type: 'pilgrimage', shrine: shrine.id };
      }, 'setting out on pilgrimage');
    }
  }

  // A dying settlement is worth abandoning: refugees seek fuller hearths.
  if (s && s.members.size <= 3 && (s.stock.food < 2 || sim.day - s.lastRaidedDay < 40)) {
    let refuge = null, refugeD = 61;
    for (const o of sim.settlements.values()) {
      if (o.id === s.id || o.members.size < 4) continue;
      const d = dist(s.x, s.y, o.x, o.y);
      if (d < refugeD) { refugeD = d; refuge = o; }
    }
    if (refuge) {
      add(4, () => {
        p.task = { type: 'migrate', x: refuge.x, y: refuge.y };
        remember(p, sim, `gave up on ${s.name} and set out for ${refuge.name}`, -0.1);
      }, 'abandoning a dying home');
    }
  }

  // Striking out: the ambitious, the exiled and the overcrowded found new homes.
  const crowded = s && s.members.size > 18;
  const leader = s ? chiefOf(sim, s) : null;
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
  // The water gives generously — until it freezes.
  if (s?.buildings.dock > 0 && s.dockAt && seasonOf(sim.day) !== 'winter' &&
      (p.skills.fish > 0.35 || sim.rng.chance(0.35))) {
    if (dist(p.x, p.y, s.dockAt.x, s.dockAt.y) > 1) {
      moveToward(sim, p, s.dockAt.x, s.dockAt.y);
      p.activity = 'heading out to fish';
      return;
    }
    p.activity = 'fishing';
    const catchAmt = 1.2 + p.skills.fish * 3 + (sim.weather.rainDays > 0 ? 0.5 : 0);
    p.skills.fish = Math.min(1, p.skills.fish + 0.006);
    p.needs.energy -= 0.08;
    deposit(sim, p, s, catchAmt);
    return;
  }
  // Farms first, in season.
  if (s && s.buildings.farm > 0 && seasonOf(sim.day) !== 'winter') {
    if (dist(p.x, p.y, s.x, s.y) > 2) { moveToward(sim, p, s.x, s.y); return; }
    const yieldAmt = (1.5 + p.skills.farm * 2.5) * Math.min(s.buildings.farm, 3);
    s.stock.food += yieldAmt;
    p.skills.farm = Math.min(1, p.skills.farm + 0.005);
    p.needs.energy -= 0.1;
    return;
  }
  // Hunt if skilled and bold — real deer, when the herds are near.
  if (p.skills.hunt + p.traits.courage > 1.1 && sim.rng.chance(0.4)) {
    const herd = nearestHerd(sim, p.x, p.y, 10);
    if (herd && dist(p.x, p.y, herd.x, herd.y) > 2) { moveToward(sim, p, herd.x, herd.y, 4); return; }
    const success = sim.rng.chance((herd ? 0.55 : 0.25) + p.skills.hunt * 0.4);
    p.skills.hunt = Math.min(1, p.skills.hunt + 0.006);
    if (success) {
      const meat = herd && cullHerd(sim, herd) ? sim.rng.range(5, 9) : sim.rng.range(2, 5);
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
  let devotion = p.traits.faith * (s?.buildings.temple ? 2 : 1);
  // An organized faith prays louder — loudest when the god lives its doctrine.
  const creed = religionOf(sim, p);
  if (creed) {
    devotion *= creed.doctrine === godTone(sim) ? 2.2 : 1.4;
  }
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

// ---------- The outlaw's day: lurk, rob, survive ----------
function outlawDay(sim, p) {
  const threat = nearestMonster(sim, p, 8);
  if (threat) { doFlee(sim, p, threat); return; }
  if (p.needs.hunger > 0.8) { doGetFood(sim, p, null); p.activity = 'scrounging'; return; }
  if (p.needs.energy < 0.25) { p.needs.energy = Math.min(1, p.needs.energy + 0.5); p.activity = 'lying low'; return; }

  // Prey: someone alone on the road carrying something worth taking.
  let mark = null, markD = 11;
  for (const o of sim.folk.values()) {
    if (!o.alive || o.id === p.id || o.outlaw) continue;
    const worth = o.carriedFood + (o.task?.type === 'trade' ? o.task.carrying : 0);
    if (worth < 2) continue;
    if (folkNear(sim, o, 3).filter(n => !n.outlaw).length > 1) continue; // too many witnesses
    const d = dist(p.x, p.y, o.x, o.y);
    if (d < markD) { markD = d; mark = o; }
  }
  if (mark) { doRob(sim, p, mark); return; }

  // Otherwise haunt the roads: worn paths far from village eyes.
  const lurkSpot = findBestTile(sim.world, p.x, p.y, 10, (t, d) => {
    if (t.traffic < 5) return 0;
    for (const s of sim.settlements.values()) {
      if (s.members.size > 0 && dist(t.x, t.y, s.x, s.y) < 7) return 0;
    }
    return t.traffic - d * 0.3;
  });
  if (lurkSpot) moveToward(sim, p, lurkSpot.x, lurkSpot.y);
  else doExplore(sim, p);
  p.activity = 'lying in wait';
}

function doRob(sim, p, mark) {
  p.activity = 'stalking a traveler';
  if (dist(p.x, p.y, mark.x, mark.y) > 1) { moveToward(sim, p, mark.x, mark.y, 4); return; }
  const outlawArm = p.skills.fight * 2.5 + p.traits.courage + 0.5;
  const markArm = mark.skills.fight * 2.5 + mark.traits.courage;
  if (outlawArm * sim.rng.range(0.7, 1.3) > markArm) {
    let loot = mark.carriedFood;
    mark.carriedFood = 0;
    if (mark.task?.type === 'trade') {
      loot += mark.task.carrying;
      mark.task = null;
    }
    p.carriedFood += loot;
    if (sim.rng.chance(0.3)) { mark.injured += 4; mark.health -= 0.12; }
    mark.mood -= 0.25;
    adjustAff(mark, p.id, -50);
    chronicle(sim, 1, `${displayName(mark)} was waylaid on the road by the outlaw ${displayName(p)}`,
      { x: p.x, y: p.y, kind: 'banditry', who: [p.id, mark.id] });
    remember(mark, sim, `was robbed by ${p.name}`);
    remember(p, sim, `robbed ${mark.name} on the road`);
    const home = mark.home !== null ? sim.settlements.get(mark.home) : null;
    if (home) {
      home.robbedCount = (home.robbedCount ?? 0) + 1;
      home.wantedId = p.id;
    }
  } else {
    p.injured += 5;
    p.health -= 0.2;
    mark.fame += 0.3;
    adjustAff(mark, p.id, -40);
    chronicle(sim, 1, `${displayName(mark)} fought off the outlaw ${displayName(p)}`,
      { x: p.x, y: p.y, kind: 'banditry', who: [mark.id, p.id] });
    remember(p, sim, `was beaten bloody by ${mark.name}`);
    moveToward(sim, p, p.x + sim.rng.int(-8, 8), p.y + sim.rng.int(-8, 8), 4);
  }
}

// A posse on an outlaw's trail.
function doManhunt(sim, p) {
  const quarry = sim.folk.get(p.task.target);
  p.task.days = (p.task.days ?? 0) + 1;
  if (!quarry?.alive || !quarry.outlaw || p.task.days > 25) {
    p.task = null;
    return;
  }
  p.activity = `hunting the outlaw ${quarry.name}`;
  moveToward(sim, p, quarry.x, quarry.y, 4);
  if (dist(p.x, p.y, quarry.x, quarry.y) > 1) return;
  const allies = folkNear(sim, p, 2).filter(o => o.task?.type === 'hunt');
  const posseArm = (p.skills.fight * 3 + p.traits.courage) * (1 + allies.length * 0.5) * sim.rng.range(0.8, 1.3);
  const outlawArm = (quarry.skills.fight * 3 + quarry.traits.courage + 1) * sim.rng.range(0.7, 1.3);
  if (posseArm > outlawArm) {
    kill(sim, quarry, 'justice', { killer: p });
    p.fame += 1;
    for (const a of allies) { a.task = null; a.mood += 0.1; }
    p.task = null;
  } else {
    p.injured += 4;
    p.health -= 0.15;
    quarry.skills.fight = Math.min(1, quarry.skills.fight + 0.02);
    remember(quarry, sim, 'slipped a hunter\'s noose');
  }
}

function doPilgrimage(sim, p) {
  const shrine = sim.shrines.get(p.task.shrine);
  if (!shrine) { p.task = null; return; }
  p.activity = `on pilgrimage to ${shrine.name}`;
  moveToward(sim, p, shrine.x, shrine.y, 3);
  if (dist(p.x, p.y, shrine.x, shrine.y) > 1) return;
  p.lastPilgrimage = sim.day;
  p.mood += 0.25;
  p.traits.faith = Math.min(1, p.traits.faith + 0.05);
  p.needs.social = Math.min(1, p.needs.social + 0.3);
  sim.faith += 3;
  remember(p, sim, `knelt at ${shrine.name}`, 0.1);
  p.task = { type: 'goHome' };
}

function doTradeMarch(sim, p) {
  const t = p.task;
  const target = sim.settlements.get(t.to);
  if (!target || target.members.size === 0) {
    // Nobody left to feed; carry it home again.
    p.task = { type: 'goHome' };
    p.carriedTrade = t.carrying;
    return;
  }
  p.activity = `carrying food to ${target.name}`;
  moveToward(sim, p, target.x, target.y, 4);
  if (dist(p.x, p.y, target.x, target.y) <= 2) {
    target.stock.food += t.carrying;
    const home = settlementOf(sim, p);
    if (home) adjustSettlementRelation(home, target, 12);
    for (const o of membersOf(sim, target)) adjustAff(o, p.id, 8);
    p.fame += 0.3;
    p.mood += 0.15;
    chronicle(sim, 1, `${displayName(p)} arrived in ${target.name} with ${Math.round(t.carrying)} measures of food from ${home ? home.name : 'afar'}`,
      { x: target.x, y: target.y, kind: 'trade', who: [p.id] });
    remember(p, sim, `brought relief to ${target.name}`, 0.15);
    p.task = { type: 'goHome' };
  }
}

function doGoHome(sim, p) {
  const s = settlementOf(sim, p);
  if (!s) { p.task = null; return; }
  p.activity = 'heading home';
  moveToward(sim, p, s.x, s.y, 4);
  if (dist(p.x, p.y, s.x, s.y) <= 2) {
    if (p.carriedTrade) { s.stock.food += p.carriedTrade; p.carriedTrade = 0; }
    p.task = null;
  }
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
