// The player's hand: never direct control, only influence. Miracles and
// calamities that the folk interpret, worship, fear — and act on themselves.

import { chronicle, remember } from './chronicle.js';
import { tileAt, dist, BIOME } from './world.js';
import { adjustSettlementRelation, kill, infect } from './character.js';
import { spawnMonster } from './monsters.js';
import { recordDeed } from './religion.js';
import { folkNear } from './social.js';

export const POWERS = {
  bounty: {
    name: 'Bounty', cost: 20, target: 'tile', icon: '❁',
    desc: 'Bless the land: crops and wild food flourish here for a season.',
  },
  rain: {
    name: 'Gentle Rain', cost: 15, target: 'world', icon: '☔',
    desc: 'Send rain across the land, ending drought and quickening growth.',
  },
  heal: {
    name: 'Healing Light', cost: 15, target: 'person', icon: '✚',
    desc: 'Mend the body and lift the spirit of one soul.',
  },
  dream: {
    name: 'Soothing Dream', cost: 10, target: 'person', icon: '☾',
    desc: 'Visit one soul in sleep: despair lifts, and their bitterest grudge loosens its grip.',
  },
  inspire: {
    name: 'Inspiration', cost: 15, target: 'person', icon: '☀',
    desc: 'Fill one soul with courage and purpose for a season.',
  },
  omenPeace: {
    name: 'Omen of Peace', cost: 25, target: 'settlement', icon: '☮',
    desc: 'Send dreams of kinship: this settlement softens toward all its neighbors.',
  },
  omenWar: {
    name: 'Omen of War', cost: 25, target: 'settlement', icon: '⚔',
    desc: 'Send dreams of wrath: this settlement hardens against all its neighbors.',
  },
  blight: {
    name: 'Blight', cost: 20, target: 'tile', icon: '☠',
    desc: 'Curse the land: crops wither and the soil sours.',
  },
  lightning: {
    name: 'Lightning', cost: 30, target: 'tile', icon: '⚡',
    desc: 'Strike a place with divine fire. Kills what stands there. The folk will remember.',
  },
  beast: {
    name: 'Send Beast', cost: 40, target: 'tile', icon: '🐺',
    desc: 'Loose a wolf pack upon the land. A test — or a punishment.',
  },
  quake: {
    name: 'Earthquake', cost: 50, target: 'tile', icon: '⌇',
    desc: 'Shake the earth. Buildings crumble and folk flee in terror.',
  },
};

// Witnesses interpret what they see. Miracles kindle faith; wrath kindles fear
// (which is its own kind of faith), but the god who smites too freely is hated.
function witness(sim, x, y, radius, awe, dread, desc = null) {
  let count = 0;
  for (const p of sim.folk.values()) {
    if (!p.alive || dist(p.x, p.y, x, y) > radius) continue;
    count++;
    p.traits.faith = Math.min(1, p.traits.faith + awe * 0.1 + dread * 0.06);
    p.mood += awe * 0.1 - dread * 0.15;
    if (awe > 0) remember(p, sim, 'witnessed a miracle');
    if (dread > 0) remember(p, sim, 'witnessed the god\'s wrath');
  }
  if (count > 0) {
    sim.faithWitnessed++;
    // The folk keep a tally of what kind of god watches them.
    sim.godDeeds.mercy += awe * Math.min(count, 6) * 0.5;
    sim.godDeeds.wrath += dread * Math.min(count, 6) * 0.5;
    sim.lastDeedDay = sim.day;
    if (desc) recordDeed(sim, x, y, radius, awe >= dread ? 'mercy' : 'wrath', desc);
  }
  return count;
}

export function canCast(sim, key) {
  return sim.faith >= POWERS[key].cost;
}

// Returns a human-readable result string, or null if the cast failed.
export function castPower(sim, key, target) {
  const power = POWERS[key];
  if (!power || sim.faith < power.cost) return null;
  let result = null;

  switch (key) {
    case 'bounty': {
      const { x, y } = target;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const t = tileAt(sim.world, x + dx, y + dy);
        if (t) { t.bounty = Math.min(1, t.bounty + 0.8); t.blight = 0; t.food = Math.min(t.maxFood * 2, t.food + 4); }
      }
      witness(sim, x, y, 10, 1, 0, 'the sudden ripening of the fields');
      chronicle(sim, 1, 'The land was blessed with sudden abundance', { x, y, kind: 'miracle' });
      result = 'The land ripens.';
      break;
    }
    case 'rain': {
      sim.weather.rainDays = 5;
      if (sim.weather.drought) {
        sim.weather.drought = false;
        chronicle(sim, 2, 'Rain broke the drought — the folk call it a miracle', { kind: 'miracle' });
      } else {
        chronicle(sim, 0, 'A gentle rain fell across the land', { kind: 'miracle' });
      }
      for (const s of sim.settlements.values()) {
        if (s.members.size) witness(sim, s.x, s.y, 6, 0.5, 0, 'the sent rain');
      }
      result = 'Rain falls.';
      break;
    }
    case 'heal': {
      const p = target.person;
      if (!p?.alive) return null;
      p.health = 1; p.sick = false; p.injured = 0;
      p.mood += 0.4;
      p.traits.faith = Math.min(1, p.traits.faith + 0.25);
      remember(p, sim, 'was healed by a light from beyond', 0.3);
      witness(sim, p.x, p.y, 6, 1, 0, `the healing of ${p.name}`);
      chronicle(sim, 1, `${p.name} was healed by divine grace`, { x: p.x, y: p.y, kind: 'miracle', who: [p.id] });
      result = `${p.name} is made whole.`;
      break;
    }
    case 'dream': {
      const p = target.person;
      if (!p?.alive) return null;
      p.mood = Math.min(1, p.mood + 0.35);
      p.needs.energy = 1;
      // The oldest hatred loosens — not into love, but into something bearable.
      let worstId = null, worstAff = -20;
      for (const [id, r] of p.rel) {
        if (r.aff < worstAff && sim.folk.get(id)?.alive) { worstAff = r.aff; worstId = id; }
      }
      if (worstId !== null) {
        const enemy = sim.folk.get(worstId);
        p.rel.get(worstId).aff = Math.min(-5, worstAff + 55);
        remember(p, sim, `dreamed of ${enemy.name}, and woke with the hate gone quiet`, 0.1);
        result = `${p.name} dreams, and forgives a little.`;
      } else {
        remember(p, sim, 'slept a night without any weight at all', 0.1);
        result = `${p.name} sleeps in peace.`;
      }
      p.traits.faith = Math.min(1, p.traits.faith + 0.08);
      chronicle(sim, 0, `${p.name} woke gentled by a dream`, { x: p.x, y: p.y, kind: 'miracle', who: [p.id] });
      break;
    }
    case 'inspire': {
      const p = target.person;
      if (!p?.alive) return null;
      p.inspired = 24;
      p.traits.courage = Math.min(1, p.traits.courage + 0.2);
      p.traits.diligence = Math.min(1, p.traits.diligence + 0.15);
      p.mood += 0.3;
      remember(p, sim, 'woke with fire in their heart', 0.2);
      result = `${p.name} burns with purpose.`;
      break;
    }
    case 'omenPeace': case 'omenWar': {
      const s = target.settlement;
      if (!s || s.members.size === 0) return null;
      const delta = key === 'omenPeace' ? 35 : -35;
      for (const other of sim.settlements.values()) {
        if (other.id === s.id || other.members.size === 0) continue;
        if (dist(s.x, s.y, other.x, other.y) < 60) adjustSettlementRelation(s, other, delta);
      }
      chronicle(sim, 1, key === 'omenPeace'
        ? `The folk of ${s.name} dreamed of peace`
        : `The folk of ${s.name} dreamed of war`, { x: s.x, y: s.y, kind: 'omen' });
      result = key === 'omenPeace' ? `${s.name} dreams of peace.` : `${s.name} dreams of blood.`;
      break;
    }
    case 'blight': {
      const { x, y } = target;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const t = tileAt(sim.world, x + dx, y + dy);
        if (t) { t.blight = Math.min(1, t.blight + 0.8); t.bounty = 0; t.food *= 0.2; }
      }
      witness(sim, x, y, 10, 0, 1, 'the souring of the land');
      chronicle(sim, 1, 'The land sickened under an unseen curse', { x, y, kind: 'wrath' });
      result = 'The soil sours.';
      break;
    }
    case 'lightning': {
      const { x, y } = target;
      let struck = [];
      for (const p of sim.folk.values()) {
        if (p.alive && dist(p.x, p.y, x, y) <= 1) struck.push(p);
      }
      for (const p of struck) kill(sim, p, 'divine lightning');
      for (const m of [...sim.monsters.values()]) {
        if (dist(m.x, m.y, x, y) <= 1) {
          m.hp -= 60;
          if (m.hp <= 0) {
            sim.monsters.delete(m.id);
            chronicle(sim, 2, `${m.name} was destroyed by a bolt from the heavens`, { x, y, kind: 'miracle' });
            witness(sim, x, y, 12, 1.5, 0.3, `the bolt that destroyed ${m.name}`);
            result = `${m.name} is ash.`;
          }
        }
      }
      const t = tileAt(sim.world, x, y);
      if (t) { t.food *= 0.5; t.wood *= 0.5; }
      if (struck.length) {
        chronicle(sim, 2, `Lightning from a clear sky slew ${struck.map(p => p.name).join(', ')}`, { x, y, kind: 'wrath', who: struck.map(p => p.id) });
        witness(sim, x, y, 12, 0, 1.5, 'the fire that fell from a clear sky');
        result = result || 'The bolt finds its mark.';
      }
      if (!result) { witness(sim, x, y, 12, 0.3, 0.6); result = 'Thunder rolls. The folk look up.'; }
      break;
    }
    case 'beast': {
      const { x, y } = target;
      spawnMonster(sim, 'wolfpack', x, y);
      chronicle(sim, 1, 'Wolves came down from the hills as if called', { x, y, kind: 'wrath' });
      result = 'The pack hunts.';
      break;
    }
    case 'quake': {
      const { x, y } = target;
      for (const s of sim.settlements.values()) {
        if (s.members.size === 0 || dist(s.x, s.y, x, y) > 8) continue;
        for (const b of ['shelter', 'farm', 'wall', 'hall', 'temple']) {
          while (s.buildings[b] > 0 && sim.rng.chance(0.5)) s.buildings[b]--;
        }
        s.lastRaidedDay = sim.day;
        chronicle(sim, 3, `The earth shook and ${s.name} was thrown down`, { x: s.x, y: s.y, kind: 'wrath', fx: 'shake' });
        for (const p of folkNear(sim, { id: -1, x: s.x, y: s.y }, 8)) {
          p.mood -= 0.3;
          if (sim.rng.chance(0.15)) { p.injured += 6; p.health -= 0.3; }
          if (sim.rng.chance(0.05)) kill(sim, p, 'the earthquake');
        }
      }
      witness(sim, x, y, 16, 0, 1.5, 'the day the earth was thrown down');
      result = 'The earth convulses.';
      break;
    }
    default: return null;
  }

  sim.faith -= power.cost;
  return result;
}
