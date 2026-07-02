// The wilds are not empty. Wolves hunt the lonely, trolls smash what folk
// build, and once in a generation something worse takes wing.

import { beastName } from './names.js';
import { chronicle, remember } from './chronicle.js';
import { tileAt, isPassable, dist, seasonOf } from './world.js';
import { kill, adjustAff } from './character.js';
import { membersOf } from './settlement.js';

export const MONSTER_KINDS = {
  wolfpack: { hp: 14, power: 3,   speed: 4, reward: 8,  menace: 1 },
  troll:    { hp: 40, power: 9,   speed: 2, reward: 25, menace: 2 },
  dragon:   { hp: 110, power: 22, speed: 6, reward: 80, menace: 3 },
};

export function spawnMonster(sim, kind, x, y, opts = {}) {
  const def = MONSTER_KINDS[kind];
  const m = {
    id: sim.nextId++,
    kind,
    name: kind === 'wolfpack' ? 'a wolf pack' : `${beastName(sim.rng)} the ${kind}`,
    x, y,
    hp: def.hp, maxHp: def.hp,
    power: def.power,
    hunger: 0.5,
    kills: 0,
    targetSettlement: null,
  };
  sim.monsters.set(m.id, m);
  if (kind !== 'wolfpack' || !opts.quiet) {
    const level = kind === 'dragon' ? 3 : kind === 'troll' ? 2 : 1;
    chronicle(sim, level, kind === 'wolfpack'
      ? 'A wolf pack has been sighted in the wilds'
      : `${m.name} has come to the vale`, { x, y, kind: 'monster' });
  }
  return m;
}

function moveMonster(sim, m, tx, ty) {
  const def = MONSTER_KINDS[m.kind];
  for (let i = 0; i < def.speed; i++) {
    const dx = Math.sign(tx - m.x), dy = Math.sign(ty - m.y);
    if (dx === 0 && dy === 0) return;
    // dragons fly over anything
    const tryMoves = [[dx, dy], [dx, 0], [0, dy], [dx, -dy], [-dx, dy]];
    let moved = false;
    for (const [mx, my] of tryMoves) {
      if (mx === 0 && my === 0) continue;
      const nx = m.x + mx, ny = m.y + my;
      if (m.kind === 'dragon' ? tileAt(sim.world, nx, ny) : isPassable(sim.world, nx, ny)) {
        m.x = nx; m.y = ny; moved = true; break;
      }
    }
    if (!moved) return;
  }
}

function nearestPrey(sim, m, maxDist) {
  let best = null, bestD = maxDist + 1;
  for (const p of sim.folk.values()) {
    if (!p.alive) continue;
    const d = dist(m.x, m.y, p.x, p.y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function richestSettlement(sim) {
  let best = null, bestScore = 0;
  for (const s of sim.settlements.values()) {
    if (s.members.size === 0) continue;
    const score = s.stock.food + s.members.size * 4;
    if (score > bestScore) { bestScore = score; best = s; }
  }
  return best;
}

export function monsterDaily(sim, m) {
  m.hunger = Math.min(1.5, m.hunger + 0.06);

  // A beast that finds nothing to eat eventually leaves the vale.
  if (m.hunger >= 1.45) {
    m.starveDays = (m.starveDays || 0) + 1;
    if (m.starveDays > 24) {
      sim.monsters.delete(m.id);
      if (m.kind !== 'wolfpack') {
        chronicle(sim, 1, `${m.name} left the vale, finding it too poor a hunting ground`, { x: m.x, y: m.y, kind: 'monster' });
      }
      return;
    }
  } else {
    m.starveDays = 0;
  }

  if (m.kind === 'wolfpack') {
    // Wolves live off wild game while there is any; they stalk folk only
    // when lean — which above all means winter.
    const t = tileAt(sim.world, m.x, m.y);
    if (t && t.food > 1.5 && m.hunger > 0.4 && sim.rng.chance(0.35)) {
      m.hunger = Math.max(0, m.hunger - 0.4);
      t.food -= 1;
      wander(sim, m);
      return;
    }
    const winter = seasonOf(sim.day) === 'winter';
    const desperate = m.hunger > (winter ? 0.6 : 0.9);
    const prey = desperate ? nearestPrey(sim, m, 18) : null;
    if (prey) {
      const nearbyFolk = countFolkNear(sim, prey.x, prey.y, 3);
      if (nearbyFolk <= 2 || m.hunger > 1.2) {
        moveMonster(sim, m, prey.x, prey.y);
        if (dist(m.x, m.y, prey.x, prey.y) <= 1) attackPerson(sim, m, prey);
        return;
      }
    }
    wander(sim, m);
  } else if (m.kind === 'troll' || m.kind === 'dragon') {
    if (!m.targetSettlement || !sim.settlements.get(m.targetSettlement)?.members.size) {
      const t = m.kind === 'dragon' ? richestSettlement(sim) : nearestSettlement(sim, m);
      m.targetSettlement = t ? t.id : null;
    }
    const target = m.targetSettlement ? sim.settlements.get(m.targetSettlement) : null;
    if (target && m.hunger > 0.9) {
      moveMonster(sim, m, target.x, target.y);
      if (dist(m.x, m.y, target.x, target.y) <= 2) rampage(sim, m, target);
      return;
    }
    wander(sim, m);
  }
}

function nearestSettlement(sim, m) {
  let best = null, bestD = Infinity;
  for (const s of sim.settlements.values()) {
    if (s.members.size === 0) continue;
    const d = dist(m.x, m.y, s.x, s.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best;
}

export function countFolkNear(sim, x, y, r) {
  let n = 0;
  for (const p of sim.folk.values()) {
    if (p.alive && dist(x, y, p.x, p.y) <= r) n++;
  }
  return n;
}

function wander(sim, m) {
  moveMonster(sim, m, m.x + sim.rng.int(-6, 6), m.y + sim.rng.int(-6, 6));
}

function attackPerson(sim, m, p) {
  // Neighbors rally: numbers are the shield of ordinary folk.
  const allies = countFolkNear(sim, p.x, p.y, 2) - 1;
  const defense = p.skills.fight * 3 + p.traits.courage * 1.5 + allies * 0.9 + (p.injured ? -1 : 0);
  const attack = m.power * sim.rng.range(0.6, 1.4);
  if (attack > defense + 3) {
    kill(sim, p, 'beast', { monster: m });
    m.kills++;
    m.hunger = Math.max(0, m.hunger - 0.8);
  } else if (attack > defense) {
    p.injured += sim.rng.int(4, 10);
    p.health -= 0.25;
    p.mood -= 0.2;
    remember(p, sim, `was mauled by ${m.name} and barely escaped`);
  } else {
    // Fought it off — and grew from it.
    m.hp -= defense * sim.rng.range(0.4, 1);
    p.skills.fight = Math.min(1, p.skills.fight + 0.03);
    remember(p, sim, `drove off ${m.name}`, 0.15);
    if (m.hp <= 0) slayMonster(sim, m, p);
  }
}

function rampage(sim, m, s) {
  // Defenders muster; walls blunt the assault.
  const defenders = membersOf(sim, s).filter(p =>
    dist(p.x, p.y, s.x, s.y) <= 6 && (p.traits.courage > 0.35 || p.skills.fight > 0.4));
  const wallBonus = s.buildings.wall * 3;
  let defense = wallBonus;
  for (const d of defenders) defense += d.skills.fight * 2.5 + d.traits.courage;

  const attack = m.power * sim.rng.range(0.7, 1.3);
  chronicle(sim, m.kind === 'dragon' ? 3 : 2, `${m.name} attacked ${s.name}!`, { x: s.x, y: s.y, kind: 'monster' });

  if (attack > defense) {
    // The beast wins the day: deaths, ruin, plunder.
    const victims = sim.rng.shuffle(membersOf(sim, s)).slice(0, m.kind === 'dragon' ? 3 : 1);
    for (const v of victims) {
      if (sim.rng.chance(0.7)) { kill(sim, v, 'beast', { monster: m }); m.kills++; }
      else { v.injured += 8; v.health -= 0.3; remember(v, sim, `was wounded when ${m.name} attacked`); }
    }
    for (const b of ['farm', 'shelter', 'hall']) {
      if (s.buildings[b] > 0 && sim.rng.chance(m.kind === 'dragon' ? 0.6 : 0.3)) {
        s.buildings[b]--;
        chronicle(sim, 1, `${m.name} destroyed ${b === 'hall' ? 'the hall' : `a ${b}`} in ${s.name}`, { x: s.x, y: s.y, kind: 'monster' });
      }
    }
    const eaten = Math.min(s.stock.food, m.kind === 'dragon' ? 30 : 12);
    s.stock.food -= eaten;
    m.hunger = 0;
    s.lastRaidedDay = sim.day;
    for (const p of membersOf(sim, s)) { p.mood -= 0.15; }
    // Gorged beasts grow bored of the same larder.
    m.rampages = (m.rampages || 0) + 1;
    if (m.rampages >= (m.kind === 'dragon' ? 4 : 3)) {
      sim.monsters.delete(m.id);
      chronicle(sim, 2, `${m.name}, having eaten its fill, left the vale`, { x: m.x, y: m.y, kind: 'monster' });
    } else {
      m.targetSettlement = null;
    }
  } else {
    // Driven off. Heroes are made on days like this.
    m.hp -= defense * sim.rng.range(0.25, 0.6);
    m.hunger = Math.max(0, m.hunger - 0.3);
    const hero = defenders.sort((a, b) => (b.skills.fight + b.traits.courage) - (a.skills.fight + a.traits.courage))[0];
    if (m.hp <= 0 && hero) {
      slayMonster(sim, m, hero, defenders);
    } else {
      chronicle(sim, 1, `${s.name} drove off ${m.name}`, { x: s.x, y: s.y, kind: 'battle' });
      for (const d of defenders) {
        d.skills.fight = Math.min(1, d.skills.fight + 0.02);
        d.mood += 0.1;
      }
      m.targetSettlement = null; // lick wounds elsewhere
    }
  }
}

export function slayMonster(sim, m, hero, helpers = []) {
  sim.monsters.delete(m.id);
  const def = MONSTER_KINDS[m.kind];
  hero.fame += def.menace * 2;
  hero.skills.fight = Math.min(1, hero.skills.fight + 0.05);
  hero.mood += 0.3;
  chronicle(sim, def.menace >= 2 ? 3 : 2,
    `${hero.name} slew ${m.name}${m.kills ? ` (killer of ${m.kills})` : ''}!`,
    { x: m.x, y: m.y, kind: 'triumph' });
  remember(hero, sim, `slew ${m.name}`, 0.3);
  for (const h of helpers) {
    if (h.id === hero.id) continue;
    h.mood += 0.15;
    adjustAff(h, hero.id, 10); // comrades admire the slayer
  }
}
