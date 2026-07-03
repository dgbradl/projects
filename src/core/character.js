// Folk: the autonomous people of the world. Traits shape decisions,
// needs drive behavior, relationships bind (and divide) them.

import { personName, surname } from './names.js';
import { chronicle, remember } from './chronicle.js';
import { DAYS_PER_YEAR, seasonOf, tileAt } from './world.js';

export const ADULT_AGE = 14 * DAYS_PER_YEAR;
export const ELDER_AGE = 55 * DAYS_PER_YEAR;

export function makePerson(sim, opts = {}) {
  const rng = sim.rng;
  const p = {
    id: sim.nextId++,
    name: opts.name || personName(rng),
    surname: opts.surname !== undefined ? opts.surname : surname(rng),
    sex: opts.sex || (rng.chance(0.5) ? 'f' : 'm'),
    bornDay: opts.bornDay !== undefined ? opts.bornDay : sim.day,
    alive: true,
    causeOfDeath: null,
    x: opts.x, y: opts.y,
    px: opts.x, py: opts.y,           // previous-day position, for smooth rendering
    epithet: null,
    wolfPacksSlain: 0,
    murders: 0,
    religion: opts.religion ?? null,
    outlaw: false,
    homelessDays: 0,
    home: opts.home ?? null,          // settlement id
    traits: opts.traits || {
      courage: rng.float(), kindness: rng.float(), diligence: rng.float(),
      ambition: rng.float(), temper: rng.float(), curiosity: rng.float(),
      faith: rng.float(),
    },
    needs: { hunger: rng.range(0.1, 0.3), energy: rng.range(0.6, 1), warmth: 1, social: rng.range(0.3, 0.7) },
    mood: rng.range(-0.1, 0.3),
    health: 1,
    sick: false, sickDays: 0,
    injured: 0,                        // days of injury remaining
    skills: {
      forage: rng.range(0.1, 0.5), hunt: rng.range(0, 0.4), farm: rng.range(0, 0.4),
      build: rng.range(0, 0.4), fight: rng.range(0, 0.4), heal: rng.range(0, 0.3),
    },
    rel: new Map(),                    // otherId -> { aff: -100..100, kin: string|null }
    spouse: null,
    pregnantDays: 0, pregnantBy: null,
    carriedFood: rng.range(1, 3),
    task: null,                        // { type, ...args } persists across days
    memories: [],
    inspired: 0,                       // days of divine inspiration remaining
    prayedToday: false,
    fame: 0,
  };
  sim.folk.set(p.id, p);
  return p;
}

export function displayName(p) {
  return p.epithet ? `${p.name} ${p.epithet}` : p.name;
}

export function fullName(p) {
  return `${p.name}${p.surname ? ' ' + p.surname : ''}${p.epithet ? ', ' + p.epithet : ''}`;
}

// A name earned is a name kept: only the first epithet sticks.
export function grantEpithet(sim, p, epithet) {
  if (p.epithet || !p.alive) return;
  p.epithet = epithet;
  chronicle(sim, 2, `${p.name} earned the name "${p.name} ${epithet}"`, { x: p.x, y: p.y, kind: 'epithet', who: [p.id] });
  p.mood += 0.2;
}

export function ageOf(sim, p) { return sim.day - p.bornDay; }
export function ageYears(sim, p) { return Math.floor(ageOf(sim, p) / DAYS_PER_YEAR); }
export function isAdult(sim, p) { return ageOf(sim, p) >= ADULT_AGE; }
export function isElder(sim, p) { return ageOf(sim, p) >= ELDER_AGE; }

export function relTo(p, otherId) {
  let r = p.rel.get(otherId);
  if (!r) { r = { aff: 0, kin: null }; p.rel.set(otherId, r); }
  return r;
}

export function adjustAff(p, otherId, delta) {
  const r = relTo(p, otherId);
  r.aff = Math.max(-100, Math.min(100, r.aff + delta));
  return r.aff;
}

export function setKin(a, b, kinAB, kinBA) {
  relTo(a, b.id).kin = kinAB;
  relTo(b, a.id).kin = kinBA;
}

// Personality compatibility: like-minded kindness/curiosity attract, twin tempers repel.
export function compat(a, b) {
  return 0.5
    - Math.abs(a.traits.kindness - b.traits.kindness) * 0.4
    - Math.abs(a.traits.curiosity - b.traits.curiosity) * 0.3
    - Math.min(a.traits.temper, b.traits.temper) * 0.4
    + Math.min(a.traits.kindness, b.traits.kindness) * 0.4;
}

export function settlementOf(sim, p) {
  return p.home !== null ? sim.settlements.get(p.home) ?? null : null;
}

// ---- Daily metabolism: hunger, cold, sickness, aging. The quiet killers. ----
export function metabolize(sim, p) {
  const season = seasonOf(sim.day);
  const s = settlementOf(sim, p);
  const tile = tileAt(sim.world, p.x, p.y);
  // The orders of quiet endurance train the body to want less.
  const stoic = p.religion !== null && sim.religions?.get(p.religion)?.doctrine === 'silence' ? 0.85 : 1;

  // Hunger
  p.needs.hunger = Math.min(1.5, p.needs.hunger + 0.16);
  if (p.needs.hunger > 0.45) tryEat(sim, p);
  if (p.needs.hunger >= 1) {
    p.health -= 0.045 * stoic;
    p.mood -= 0.03;
    if (p.task?.type !== 'getFood') p.task = null; // starving overrides plans
  }

  // Warmth: winter bites hardest outside shelter.
  if (season === 'winter' || (tile && tile.biome === 'tundra')) {
    const sheltered = s && Math.abs(p.x - s.x) + Math.abs(p.y - s.y) <= 3 && s.buildings.shelter * 5 >= s.members.size * 0.8;
    const fire = s && s.stock.wood > 0;
    let drain = 0.22;
    if (sheltered) drain -= 0.13;
    if (fire) drain -= 0.08;
    if (sim.weather.storm) drain += 0.1;
    p.needs.warmth = Math.max(0, p.needs.warmth - Math.max(0.01, drain));
  } else {
    p.needs.warmth = Math.min(1, p.needs.warmth + 0.3);
  }
  if (p.needs.warmth <= 0.15) {
    p.health -= 0.035 * stoic;
    if (sim.rng.chance(0.03)) infect(sim, p, 'a chill');
  }

  // Energy & social drift
  p.needs.energy = Math.max(0, p.needs.energy - 0.12);
  p.needs.social = Math.max(0, p.needs.social - 0.03);
  if (p.needs.social < 0.2) p.mood -= 0.01;

  // Sickness
  if (p.sick) {
    p.sickDays++;
    p.health -= sim.plague.active ? 0.032 : 0.02;
    if (sim.rng.chance(0.11 + (p.tendedToday ? 0.12 : 0) + (p.needs.hunger < 0.6 ? 0.03 : 0))) {
      p.sick = false; p.sickDays = 0;
      remember(p, sim, 'recovered from sickness', 0.1);
    }
  }
  p.tendedToday = false;
  p.prayedToday = false;

  // Injuries heal slowly
  if (p.injured > 0) { p.injured--; p.health = Math.min(p.health, 0.9); }

  // Aging
  const age = ageOf(sim, p);
  if (age > ELDER_AGE) {
    const overYears = (age - ELDER_AGE) / DAYS_PER_YEAR;
    if (sim.rng.chance(0.0006 * (1 + overYears * 0.5))) {
      kill(sim, p, 'old age');
      return;
    }
  }

  // Natural healing & mood drift toward temperament baseline
  if (!p.sick && p.needs.hunger < 0.7) p.health = Math.min(1, p.health + 0.02);
  p.mood *= 0.985;
  if (p.inspired > 0) { p.inspired--; p.mood += 0.01; }

  if (p.health <= 0) {
    kill(sim, p, p.sick ? 'sickness' : (p.needs.hunger >= 1 ? 'starvation' : 'exposure'));
  }
}

export function tryEat(sim, p) {
  const need = p.needs.hunger;
  let eaten = 0;
  if (p.carriedFood >= 1) { p.carriedFood -= 1; eaten = 1; }
  else {
    const s = settlementOf(sim, p);
    if (s && s.stock.food >= 1 && Math.abs(p.x - s.x) + Math.abs(p.y - s.y) <= 4) {
      s.stock.food -= 1; eaten = 1;
    } else {
      const tile = tileAt(sim.world, p.x, p.y);
      if (tile && tile.food >= 1) { tile.food -= 1; eaten = 1; }
    }
  }
  if (eaten) p.needs.hunger = Math.max(0, need - 0.55);
  return eaten > 0;
}

export function infect(sim, p, source) {
  if (p.sick || !p.alive) return;
  p.sick = true;
  p.sickDays = 0;
  remember(p, sim, `fell sick from ${source}`, -0.15);
}

// ---- Death: the world remembers, and the living grieve or seethe. ----
export function kill(sim, p, cause, opts = {}) {
  if (!p.alive) return;
  p.alive = false;
  p.causeOfDeath = cause;
  p.diedDay = sim.day;
  p.task = null;
  const s = settlementOf(sim, p);
  if (s) s.members.delete(p.id);

  const age = ageYears(sim, p);
  const killer = opts.killer || null;
  const importance = killer || p.fame > 3 ? 2 : 1;
  let text = `${displayName(p)} died of ${cause} at ${age}`;
  if (killer) text = `${displayName(p)} was slain by ${displayName(killer)} at ${age}`;
  if (opts.monster) text = `${displayName(p)} was killed by ${opts.monster.name} at ${age}`;
  chronicle(sim, importance, text, {
    x: p.x, y: p.y, kind: 'death',
    who: killer ? [p.id, killer.id] : [p.id],
  });

  // Grief and grudges ripple through the living.
  for (const other of sim.folk.values()) {
    if (!other.alive || other.id === p.id) continue;
    const r = other.rel.get(p.id);
    if (!r) continue;
    if (r.aff > 40 || r.kin) {
      other.mood -= r.kin ? 0.35 : 0.2;
      remember(other, sim, `grieved for ${p.name}`);
      if (killer && killer.alive) {
        adjustAff(other, killer.id, -70);
        remember(other, sim, `swore ${killer.name} would pay for ${p.name}'s death`);
      }
      if (opts.blamedSettlement !== undefined && other.home !== null && other.home !== opts.blamedSettlement) {
        const os = sim.settlements.get(other.home);
        const bs = sim.settlements.get(opts.blamedSettlement);
        if (os && bs) adjustSettlementRelation(os, bs, -12);
      }
    } else if (r.aff < -40) {
      other.mood += 0.08; // quiet satisfaction at an enemy's end
    }
  }
  if (p.spouse !== null) {
    const sp = sim.folk.get(p.spouse);
    if (sp && sp.alive) sp.spouse = null;
  }
}

export function adjustSettlementRelation(a, b, delta) {
  const cur = a.relations.get(b.id) ?? 0;
  const next = Math.max(-100, Math.min(100, cur + delta));
  a.relations.set(b.id, next);
  b.relations.set(a.id, next);
}
