// Religion: the folk trying to make sense of you.
//
// No faith is ever installed from above. When the god works miracles, someone
// devout eventually proclaims a Way of mercy; when the god smites, a cult of
// wrath; when the god does nothing for years, an order arises around the
// silence itself. Belief spreads along friendships and bloodlines, shapes
// temperament, dedicates temples, sours relations between rival creeds —
// and when the god betrays a doctrine, or prophets fall out, the faith splits.

import { chronicle, remember } from './chronicle.js';
import { dist, DAYS_PER_YEAR } from './world.js';
import { isAdult, relTo, displayName, grantEpithet } from './character.js';
import { membersOf } from './settlement.js';

export const DOCTRINES = {
  mercy:   { symbol: '☼', word: 'a faith of mercy' },
  wrath:   { symbol: '⚡', word: 'a cult of dread' },
  silence: { symbol: '◌', word: 'an order of quiet endurance' },
};

const NAME_PARTS = {
  mercy:   ['the Way of the Green Hand', 'the Way of the Gentle Rain', 'the Way of the Open Palm',
            'the Way of the Kind Light', 'the Way of the Mended Bough', 'the Way of the Warm Hearth'],
  wrath:   ['the Cult of the Burning Sky', 'the Cult of the Red Bolt', 'the Cult of the Shaken Earth',
            'the Cult of the Hungry Storm', 'the Cult of the Iron Thunder', 'the Cult of the Black Cloud'],
  silence: ['the Order of the Empty Throne', 'the Order of the Silent Sky', 'the Order of the Long Watch',
            'the Order of the Unspoken Name', 'the Order of the Still Water', 'the Order of the Patient Stone'],
};

export function countFollowers(sim, rid) {
  let n = 0;
  for (const p of sim.folk.values()) if (p.alive && p.religion === rid) n++;
  return n;
}

export function religionOf(sim, p) {
  return p.religion !== null && p.religion !== undefined ? sim.religions.get(p.religion) ?? null : null;
}

export function doctrineOf(sim, p) {
  return religionOf(sim, p)?.doctrine ?? null;
}

function unusedName(sim, doctrine) {
  const used = new Set([...sim.religions.values()].map(r => r.name));
  const free = NAME_PARTS[doctrine].filter(n => !used.has(n));
  return free.length ? sim.rng.pick(free) : sim.rng.pick(NAME_PARTS[doctrine]);
}

export function convert(sim, p, religion, quiet = false) {
  if (p.religion === religion.id) return;
  p.religion = religion.id;
  p.traits.faith = Math.min(1, p.traits.faith + 0.05);
  if (!quiet) remember(p, sim, `embraced ${religion.name}`, 0.08);
}

export function foundReligion(sim, prophet, doctrine, schismOf = null) {
  const r = {
    id: sim.nextId++,
    name: unusedName(sim, doctrine),
    doctrine,
    symbol: DOCTRINES[doctrine].symbol,
    prophetId: prophet.id,
    bornDay: sim.day,
    schismOf,
    faded: false,
  };
  sim.religions.set(r.id, r);
  prophet.religion = r.id;
  prophet.traits.faith = 1;
  prophet.fame += 3;
  grantEpithet(sim, prophet, 'the Prophet');
  chronicle(sim, 3, schismOf
    ? `Schism! ${displayName(prophet)} broke away, proclaiming ${r.name} — ${DOCTRINES[doctrine].word}`
    : `${displayName(prophet)} proclaimed ${r.name} — ${DOCTRINES[doctrine].word}`,
    { x: prophet.x, y: prophet.y, kind: schismOf ? 'schism' : 'prophecy', who: [prophet.id] });
  remember(prophet, sim, `heard the god and proclaimed ${r.name}`, 0.4);

  // The first congregation: kin, friends and neighbors moved by the word.
  for (const o of sim.folk.values()) {
    if (!o.alive || o.id === prophet.id || dist(o.x, o.y, prophet.x, prophet.y) > 14) continue;
    const bond = relTo(o, prophet.id).aff;
    if (o.traits.faith > 0.45 && sim.rng.chance(0.35 + o.traits.faith * 0.3 + Math.max(0, bond) / 200)) {
      convert(sim, o, r, true);
    }
  }
  return r;
}

// How the folk currently read their god, from the deeds they have witnessed.
export function godTone(sim) {
  const { mercy, wrath } = sim.godDeeds;
  if (mercy > 4 && mercy > wrath * 1.5) return 'mercy';
  if (wrath > 4 && wrath > mercy * 1.5) return 'wrath';
  if (sim.day - sim.lastDeedDay > DAYS_PER_YEAR * 2 && sim.day > DAYS_PER_YEAR * 3) return 'silence';
  return null;
}

export function majorityReligion(sim, s) {
  const counts = new Map();
  for (const p of membersOf(sim, s)) {
    if (p.religion === null || p.religion === undefined) continue;
    counts.set(p.religion, (counts.get(p.religion) ?? 0) + 1);
  }
  let best = null, bestN = 2; // it takes at least three to make a creed
  for (const [rid, n] of counts) {
    if (n > bestN) { bestN = n; best = rid; }
  }
  return best !== null ? sim.religions.get(best) ?? null : null;
}

export function religionDaily(sim) {
  sim.godDeeds.mercy *= 0.997;
  sim.godDeeds.wrath *= 0.997;
  if (sim.day % 6 !== 2) return;

  const active = [...sim.religions.values()].filter(r => !r.faded);

  // Faiths whose last believer is gone pass out of the world.
  for (const r of active) {
    if (countFollowers(sim, r.id) === 0 && sim.day - r.bornDay > 30) {
      r.faded = true;
      chronicle(sim, 2, `${r.name} faded from the world; no one keeps its rites now`, { kind: 'faded' });
    }
  }

  maybeProphet(sim, active.filter(r => !r.faded));
  for (const r of active) {
    if (!r.faded) maybeSchism(sim, r);
  }
  doctrineShapesFolk(sim);
}

function maybeProphet(sim, active) {
  const tone = godTone(sim);
  if (!tone || active.length >= 4) return;
  if (active.some(r => r.doctrine === tone)) return; // that word is already preached
  if (!sim.rng.chance(0.06)) return;
  const candidates = [...sim.folk.values()].filter(p =>
    p.alive && isAdult(sim, p) && p.traits.faith > 0.7 && (p.religion === null || p.religion === undefined));
  if (!candidates.length) return;
  candidates.sort((a, b) => (b.traits.faith + b.traits.curiosity) - (a.traits.faith + a.traits.curiosity));
  const prophet = candidates[Math.min(sim.rng.int(0, 2), candidates.length - 1)];
  foundReligion(sim, prophet, tone);
}

function maybeSchism(sim, r) {
  const followers = [...sim.folk.values()].filter(p => p.alive && p.religion === r.id);
  if (followers.length < 6 || !sim.rng.chance(0.03)) return;
  const prophet = sim.folk.get(r.prophetId);

  // Betrayal: the god's recent deeds mock the doctrine.
  const { mercy, wrath } = sim.godDeeds;
  const betrayed =
    (r.doctrine === 'mercy' && wrath > 6 && wrath > mercy * 1.5) ? 'wrath' :
    (r.doctrine === 'wrath' && mercy > 6 && mercy > wrath * 1.5) ? 'mercy' :
    (r.doctrine === 'silence' && (mercy > 6 || wrath > 6)) ? (mercy > wrath ? 'mercy' : 'wrath') : null;

  if (betrayed) {
    const founder = pickSplinterFounder(sim, followers, r.prophetId);
    if (!founder) return;
    const splinter = foundReligion(sim, founder, betrayed, r.id);
    for (const f of followers) {
      if (f.id === founder.id || !f.alive) continue;
      if (sim.rng.chance(0.45)) convert(sim, f, splinter, true);
    }
    if (prophet?.alive) {
      // Old prophet and new despise each other ever after.
      relTo(prophet, founder.id).aff = -80;
      relTo(founder, prophet.id).aff = -80;
    }
    return;
  }

  // Rivalry: a famous believer who hates the prophet takes the flock's half.
  if (prophet?.alive) {
    const rival = followers.find(f =>
      f.id !== prophet.id && f.fame >= 2 && relTo(f, prophet.id).aff < -35);
    if (rival) {
      const splinter = foundReligion(sim, rival, r.doctrine, r.id);
      for (const f of followers) {
        if (f.id === rival.id || !f.alive) continue;
        if (relTo(f, rival.id).aff > relTo(f, prophet.id).aff) convert(sim, f, splinter, true);
      }
    }
  }
}

function pickSplinterFounder(sim, followers, excludeId) {
  let best = null, bestScore = 0.5;
  for (const f of followers) {
    if (f.id === excludeId || !isAdult(sim, f)) continue;
    const score = f.traits.ambition + f.traits.faith * 0.5;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return best;
}

// Belief works slowly on the believer: doctrine becomes temperament.
function doctrineShapesFolk(sim) {
  for (const p of sim.folk.values()) {
    if (!p.alive || p.religion === null || p.religion === undefined) continue;
    const r = sim.religions.get(p.religion);
    if (!r) { p.religion = null; continue; }
    if (r.doctrine === 'mercy') p.traits.kindness = Math.min(1, p.traits.kindness + 0.002);
    else if (r.doctrine === 'wrath') p.traits.courage = Math.min(1, p.traits.courage + 0.002);
    else p.traits.temper = Math.max(0, p.traits.temper - 0.0015);
  }
}
