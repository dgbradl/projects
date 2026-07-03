// Love, friendship, feuds and blood: the bonds and wounds between folk.

import { chronicle, remember } from './chronicle.js';
import { dist } from './world.js';
import {
  makePerson, isAdult, relTo, adjustAff, setKin, compat, kill, ageYears, displayName, grantEpithet,
  adjustSettlementRelation,
} from './character.js';
import { joinSettlement } from './settlement.js';
import { religionOf, convert } from './religion.js';

const GESTATION_DAYS = 56;

export function folkNear(sim, p, r) {
  const out = [];
  for (const o of sim.folk.values()) {
    if (o.alive && o.id !== p.id && dist(p.x, p.y, o.x, o.y) <= r) out.push(o);
  }
  return out;
}

// A day spent in company: bonds deepen or fray by temperament.
export function socialize(sim, p) {
  const near = folkNear(sim, p, 3);
  if (!near.length) return false;
  const other = sim.rng.pick(near);
  let c = compat(p, other);
  // Rival creeds strain even easy company; zealots most of all.
  const pr = religionOf(sim, p), or_ = religionOf(sim, other);
  if (pr && or_ && pr.id !== or_.id) {
    c -= 0.25 + Math.max(p.traits.faith, other.traits.faith) * 0.3;
  }
  const existing = relTo(p, other.id).aff;
  if (c > 0 || existing > 20) {
    spreadFaith(sim, p, other, pr, or_);
    const gain = 2 + c * 5;
    adjustAff(p, other.id, gain);
    adjustAff(other, p.id, gain * 0.8);
    p.needs.social = Math.min(1, p.needs.social + 0.5);
    other.needs.social = Math.min(1, other.needs.social + 0.3);
    p.mood += 0.04; other.mood += 0.03;
  } else {
    // A quarrel. Hot tempers make lasting enemies of small slights.
    const sting = 2 + (p.traits.temper + other.traits.temper) * 4;
    adjustAff(p, other.id, -sting);
    adjustAff(other, p.id, -sting);
    p.mood -= 0.05; other.mood -= 0.05;
    if (relTo(p, other.id).aff < -30 && sim.rng.chance(0.3)) {
      remember(p, sim, `quarreled bitterly with ${other.name}`);
      remember(other, sim, `quarreled bitterly with ${p.name}`);
    }
  }
  return true;
}

// Faith passes along friendship: the devout draw in the doubting, and
// grief and despair open doors that contentment keeps shut.
function spreadFaith(sim, p, other, pr, or_) {
  const [src, dst, srcRel, dstRel] =
    p.traits.faith > other.traits.faith + 0.15 ? [p, other, pr, or_] : [other, p, or_, pr];
  if (!srcRel || srcRel === dstRel) return;
  let chance = src.traits.faith * 0.12 + Math.max(0, relTo(dst, src.id).aff) / 400;
  if (dst.mood < -0.2) chance += 0.08;          // the desperate listen
  if (dstRel) chance *= 0.35;                    // apostasy comes harder
  if (sim.rng.chance(chance)) convert(sim, dst, srcRel);
}

export function eligible(sim, p) {
  return p.alive && isAdult(sim, p) && p.spouse === null && ageYears(sim, p) < 52;
}

export function findMatch(sim, p) {
  // Love is worth a journey: the search reaches into neighboring villages,
  // though the near-at-hand have the advantage.
  let best = null, bestScore = 0.15;
  for (const o of folkNear(sim, p, 30)) {
    if (!eligible(sim, o) || o.sex === p.sex) continue;
    const r = relTo(p, o.id);
    if (r.kin) continue;
    const score = compat(p, o) + r.aff / 100 - dist(p.x, p.y, o.x, o.y) * 0.008;
    if (score > bestScore) { bestScore = score; best = o; }
  }
  return best;
}

export function court(sim, p, o) {
  adjustAff(p, o.id, 6);
  adjustAff(o, p.id, 5);
  p.needs.social = Math.min(1, p.needs.social + 0.4);
  const mutual = relTo(p, o.id).aff > 35 && relTo(o, p.id).aff > 30;
  if (mutual) {
    p.spouse = o.id; o.spouse = p.id;
    setKin(p, o, 'spouse', 'spouse');
    // The new couple settles together.
    if (p.home !== o.home) {
      const ps = p.home !== null ? sim.settlements.get(p.home) : null;
      const os = o.home !== null ? sim.settlements.get(o.home) : null;
      const dest = (ps?.members.size ?? 0) >= (os?.members.size ?? 0) ? ps : os;
      if (dest) { joinSettlement(sim, p, dest); joinSettlement(sim, o, dest); }
    }
    chronicle(sim, 1, `${displayName(p)} and ${displayName(o)} were wed`, { x: p.x, y: p.y, kind: 'wedding', who: [p.id, o.id] });
    remember(p, sim, `married ${o.name}`, 0.4);
    remember(o, sim, `married ${p.name}`, 0.4);
    // A marriage is usually a conversion too — the milder faith yields.
    if (p.religion !== o.religion) {
      const [strong, weak] = p.traits.faith >= o.traits.faith ? [p, o] : [o, p];
      const creed = religionOf(sim, strong);
      if (creed && sim.rng.chance(0.6)) convert(sim, weak, creed);
    }
    // Rejected rivals take it hard.
    for (const rival of folkNear(sim, p, 12)) {
      if (rival.id === o.id || rival.id === p.id || rival.spouse !== null) continue;
      const rr = rival.rel.get(o.id);
      if (rr && rr.aff > 40 && rival.sex !== o.sex) {
        adjustAff(rival, p.id, -35);
        rival.mood -= 0.25;
        remember(rival, sim, `watched ${o.name} marry ${p.name}, and it curdled something`);
      }
    }
  }
}

// Conception, gestation, birth.
export function tryConceive(sim, p) {
  if (p.sex !== 'f' || p.pregnantDays > 0 || p.spouse === null) return;
  const spouse = sim.folk.get(p.spouse);
  if (!spouse?.alive || dist(p.x, p.y, spouse.x, spouse.y) > 6) return;
  const age = ageYears(sim, p);
  if (age > 44) return;
  const wellFed = p.needs.hunger < 0.6;
  if (wellFed && sim.rng.chance(0.032)) {
    p.pregnantDays = 1;
    p.pregnantBy = spouse.id;
  }
}

export function gestate(sim, p) {
  if (p.pregnantDays <= 0) return;
  p.pregnantDays++;
  if (p.pregnantDays >= GESTATION_DAYS) {
    p.pregnantDays = 0;
    if (p.needs.hunger > 1 || p.health < 0.3) {
      remember(p, sim, 'lost a child before it drew breath', -0.3);
      return;
    }
    const father = p.pregnantBy !== null ? sim.folk.get(p.pregnantBy) : null;
    const child = makePerson(sim, {
      x: p.x, y: p.y, home: p.home,
      traits: blendTraits(sim, p, father),
      religion: p.religion,            // raised in the mother's faith
      surname: (father?.surname ?? p.surname) || null,   // the house continues
    });
    if (p.home !== null) {
      const s = sim.settlements.get(p.home);
      if (s) s.members.add(child.id);
    }
    setKin(p, child, 'child', 'parent');
    if (father?.alive) setKin(father, child, 'child', 'parent');
    adjustAff(p, child.id, 80);
    adjustAff(child, p.id, 60);
    if (father) { adjustAff(father, child.id, 70); adjustAff(child, father.id, 50); }
    // Siblings know each other.
    for (const o of sim.folk.values()) {
      if (o.id === child.id || !o.alive) continue;
      if (o.rel.get(p.id)?.kin === 'parent') {
        setKin(o, child, 'sibling', 'sibling');
        adjustAff(o, child.id, 30);
      }
    }
    chronicle(sim, 1, `${displayName(p)} gave birth to ${child.name}`, {
      x: p.x, y: p.y, kind: 'birth',
      who: father ? [p.id, child.id, father.id] : [p.id, child.id],
    });
    remember(p, sim, `gave birth to ${child.name}`, 0.35);
    p.pregnantBy = null;
  }
}

function blendTraits(sim, mother, father) {
  const t = {};
  for (const k of Object.keys(mother.traits)) {
    const base = father ? (mother.traits[k] + father.traits[k]) / 2 : mother.traits[k];
    t[k] = Math.max(0, Math.min(1, base + sim.rng.range(-0.2, 0.2)));
  }
  return t;
}

// Hatred boils over. Brawls wound; sometimes worse.
export function feudAction(sim, p, enemy) {
  const r = relTo(p, enemy.id);
  if (dist(p.x, p.y, enemy.x, enemy.y) > 2) return false;
  const rage = p.traits.temper * (1 - p.traits.kindness);
  if (r.aff < -75 && rage > 0.55 && sim.rng.chance(0.12)) {
    // Murder in cold blood.
    const pFight = p.skills.fight * 2 + p.traits.courage;
    const eFight = enemy.skills.fight * 2 + enemy.traits.courage;
    if (pFight * sim.rng.range(0.7, 1.5) > eFight) {
      kill(sim, enemy, 'murder', { killer: p });
      p.mood += 0.1;
      p.fame -= 2;
      p.murders++;
      if (p.murders >= 3) grantEpithet(sim, p, 'the Red-Handed');
      remember(p, sim, `killed ${enemy.name}, and would do it again`);
      exileIfCaught(sim, p, enemy);
    } else {
      p.injured += 6; p.health -= 0.25;
      adjustAff(enemy, p.id, -40);
      chronicle(sim, 1, `${displayName(p)} tried to kill ${displayName(enemy)} and was beaten off`, { x: p.x, y: p.y, kind: 'feud', who: [p.id, enemy.id] });
    }
  } else {
    // A brawl.
    const dmg = sim.rng.range(0.05, 0.2);
    enemy.health -= dmg;
    enemy.injured += 3;
    p.injured += sim.rng.chance(0.5) ? 2 : 0;
    adjustAff(enemy, p.id, -15);
    adjustAff(p, enemy.id, -5);
    p.mood += 0.05; enemy.mood -= 0.1;
    // A brawl across village lines sours both villages.
    if (p.home !== null && enemy.home !== null && p.home !== enemy.home) {
      const ps = sim.settlements.get(p.home), es = sim.settlements.get(enemy.home);
      if (ps && es) adjustSettlementRelation(ps, es, -4);
    }
    chronicle(sim, 0, `${displayName(p)} and ${displayName(enemy)} came to blows`, { x: p.x, y: p.y, kind: 'feud', who: [p.id, enemy.id] });
    remember(enemy, sim, `was beaten by ${p.name}`);
  }
  return true;
}

function exileIfCaught(sim, murderer, victim) {
  if (murderer.home === null) return;
  const s = sim.settlements.get(murderer.home);
  if (!s || victim.home !== s.id) return;
  // The village turns on a killer of its own.
  let outrage = 0;
  for (const id of s.members) {
    const o = sim.folk.get(id);
    if (o?.alive && o.rel.get(victim.id)?.aff > 20) outrage++;
  }
  if (outrage >= 2) {
    s.members.delete(murderer.id);
    murderer.home = null;
    murderer.outlaw = true;   // cast out with blood on their hands
    murderer.mood -= 0.3;
    chronicle(sim, 2, `${displayName(murderer)} was cast out of ${s.name} for the murder of ${victim.name}`, { x: s.x, y: s.y, kind: 'exile', who: [murderer.id, victim.id] });
    remember(murderer, sim, `was exiled from ${s.name}`);
    for (const id of s.members) {
      const o = sim.folk.get(id);
      if (o?.alive) adjustAff(o, murderer.id, -30);
    }
  }
}

// The bitterest enemy within reach, if any.
export function worstEnemy(sim, p, maxDist = 10) {
  let worst = null, worstAff = -50;
  for (const [id, r] of p.rel) {
    if (r.aff >= worstAff) continue;
    const o = sim.folk.get(id);
    if (o?.alive && dist(p.x, p.y, o.x, o.y) <= maxDist) { worst = o; worstAff = r.aff; }
  }
  return worst;
}
