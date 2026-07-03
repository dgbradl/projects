// Settlements: homes the folk build for themselves. They rise, prosper,
// squabble with their neighbors, and sometimes burn.

import { settlementName } from './names.js';
import { chronicle, remember } from './chronicle.js';
import { seasonOf, dayOfYear, tileAt, findBestTile, dist } from './world.js';
import { adjustSettlementRelation, adjustAff, displayName, isAdult } from './character.js';
import { majorityReligion } from './religion.js';

export const PROJECTS = {
  shelter: { wood: 20, stone: 4,  days: 14, desc: 'a shelter' },
  farm:    { wood: 8,  stone: 0,  days: 10, desc: 'a farm' },
  dock:    { wood: 16, stone: 0,  days: 12, desc: 'a dock' },
  wall:    { wood: 14, stone: 20, days: 20, desc: 'walls' },
  hall:    { wood: 30, stone: 10, days: 24, desc: 'a meeting hall' },
  temple:  { wood: 24, stone: 30, days: 30, desc: 'a temple' },
};

// The nearest open water within reach of the village, if any.
export function waterNear(sim, s, radius = 6) {
  return findBestTile(sim.world, s.x, s.y, radius, (t, d) => t.biome === 'water' ? radius + 1 - d : 0);
}

export function foundSettlement(sim, x, y, founder) {
  const s = {
    id: sim.nextId++,
    name: settlementName(sim.rng),
    x, y,
    founderId: founder ? founder.id : null,
    chiefId: founder ? founder.id : null,
    foundedDay: sim.day,
    members: new Set(),
    stock: { food: 10, wood: 10, stone: 0 },
    buildings: { shelter: 1, farm: 0, dock: 0, wall: 0, hall: 0, temple: 0 },
    dockAt: null,
    project: null,               // { type, workLeft, paid }
    relations: new Map(),        // other settlement id -> -100..100
    lastRaidedDay: -9999,
    raidCooldown: 0,
    tradeCooldown: 0,
    robbedCount: 0,
    wantedId: null,
    fallen: false,
  };
  sim.settlements.set(s.id, s);
  if (founder) joinSettlement(sim, founder, s);
  chronicle(sim, 2, founder
    ? `${displayName(founder)} founded the settlement of ${s.name}`
    : `The settlement of ${s.name} was founded`, { x, y, kind: 'founding', who: founder ? [founder.id] : undefined });
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

// Standing: what a claim to leadership rests on.
function standing(p) {
  return p.traits.ambition * 2 + p.fame + (p.skills.fight + p.skills.build) * 0.5;
}

// The member with the most standing (used for succession).
export function leaderOf(sim, s) {
  let best = null, bestScore = -1;
  for (const p of membersOf(sim, s)) {
    const score = standing(p);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

// The current chief — an actual office, held until death, departure or coup.
export function chiefOf(sim, s) {
  if (s.chiefId !== null && s.chiefId !== undefined) {
    const chief = sim.folk.get(s.chiefId);
    if (chief?.alive && chief.home === s.id) return chief;
  }
  return null;
}

function succession(sim, s, reason) {
  const heir = leaderOf(sim, s);
  s.chiefId = heir ? heir.id : null;
  if (heir && s.members.size >= 3) {
    heir.fame += 0.5;
    chronicle(sim, 1, `${displayName(heir)} now leads ${s.name}${reason ? ` (${reason})` : ''}`,
      { x: s.x, y: s.y, kind: 'succession', who: [heir.id] });
  }
}

// Ambition is patient, not loyal: a strong rival who despises the chief
// will eventually make a play for the seat.
function maybeChallenge(sim, s, members) {
  if (sim.day % 16 !== 9 || members.length < 5) return;
  const chief = chiefOf(sim, s);
  if (!chief) return;
  // Ambition needs no grievance — though grievance helps.
  const rival = members.find(p =>
    p.id !== chief.id && isAdult(sim, p) &&
    p.traits.ambition > 0.7 &&
    standing(p) > standing(chief) * 0.7 &&
    (p.rel.get(chief.id)?.aff ?? 0) < 15);
  if (!rival) return;
  const grudge = (rival.rel.get(chief.id)?.aff ?? 0) < -20;
  if (!sim.rng.chance(0.06 + rival.traits.temper * 0.1 + (grudge ? 0.25 : 0))) return;

  const support = (person) => {
    let backers = 0;
    for (const o of members) {
      if (o.id === person.id) continue;
      if ((o.rel.get(person.id)?.aff ?? 0) > 25) backers++;
    }
    return backers;
  };
  const rivalScore = (standing(rival) + support(rival) * 0.8) * sim.rng.range(0.7, 1.3);
  const chiefScore = (standing(chief) + support(chief) * 0.8 + 0.3) * sim.rng.range(0.7, 1.3);

  if (rivalScore > chiefScore) {
    s.chiefId = rival.id;
    rival.fame += 1;
    rival.mood += 0.3;
    chief.mood -= 0.4;
    adjustAff(chief, rival.id, -45);
    adjustAff(rival, chief.id, -20);
    chronicle(sim, 2, `${displayName(rival)} wrested leadership of ${s.name} from ${displayName(chief)}`,
      { x: s.x, y: s.y, kind: 'succession', who: [rival.id, chief.id] });
    remember(chief, sim, `was cast down as chief of ${s.name} by ${rival.name}`);
    remember(rival, sim, `took leadership of ${s.name}`, 0.2);
  } else {
    rival.mood -= 0.35;
    rival.fame -= 0.5;
    adjustAff(chief, rival.id, -35);
    adjustAff(rival, chief.id, -30);
    chronicle(sim, 1, `${displayName(chief)} put down ${displayName(rival)}'s bid to lead ${s.name}`,
      { x: s.x, y: s.y, kind: 'succession', who: [chief.id, rival.id] });
    remember(rival, sim, `was humiliated before all of ${s.name}`);
  }
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
  if (!s.buildings.dock && pop >= 5 && foodPerHead < 10 && waterNear(sim, s)) wants.push(['dock', 7]);
  if (recentlyAttacked && s.buildings.wall < 2) wants.push(['wall', 9]);
  if (s.buildings.wall < 1 && pop >= 8) wants.push(['wall', 3]);
  if (s.buildings.hall < 1 && pop >= 10) wants.push(['hall', 4]);
  if (s.buildings.temple < 1 && pop >= 10 && (sim.faithWitnessed > 2 || majorityReligion(sim, s))) wants.push(['temple', 5]);
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
      if (!foodPressure && d < 40) drift += 0.1;     // fat years make decent neighbors
      if (s.buildings.hall && other.buildings.hall) drift += 0.3;
      // Shared creeds bind villages; rival creeds set them at odds.
      const myCreed = majorityReligion(sim, s), theirCreed = majorityReligion(sim, other);
      if (myCreed && theirCreed && d < 45) {
        drift += myCreed.id === theirCreed.id ? 0.35 : -0.5;
      }
      adjustSettlementRelation(s, other, drift);
    }
  }
  if (s.raidCooldown > 0) s.raidCooldown--;
  if (s.tradeCooldown > 0) s.tradeCooldown--;

  // Justice: repeated robberies raise a posse.
  if ((s.robbedCount ?? 0) >= 2 && s.wantedId !== null && members.length >= 6 && sim.day % 8 === 1) {
    const quarry = sim.folk.get(s.wantedId);
    if (quarry?.alive && quarry.outlaw) {
      const hunters = members
        .filter(p => !p.task && !p.sick && isAdult(sim, p) && p.skills.fight + p.traits.courage > 0.9)
        .slice(0, 2);
      if (hunters.length) {
        for (const h of hunters) h.task = { type: 'hunt', target: s.wantedId };
        s.robbedCount = 0;
        chronicle(sim, 1, `${s.name} sent hunters after the outlaw ${displayName(quarry)}`,
          { x: s.x, y: s.y, kind: 'banditry', who: [quarry.id] });
      }
    } else {
      s.robbedCount = 0;
      s.wantedId = null;
    }
  }

  // The seat of the chief never sits empty for long.
  if (!chiefOf(sim, s)) succession(sim, s, s.chiefId ? 'after the last chief' : null);
  maybeChallenge(sim, s, members);
  maybeHoldFestival(sim, s, members);
  maybeSendTrader(sim, s, members);
}

// Feasts: where there is a hall and a full larder, the folk celebrate.
// Bonds form over shared tables — and so do marriages, in time.
function maybeHoldFestival(sim, s, members) {
  const doy = dayOfYear(sim.day);
  const isFeastDay = doy === 12 || doy === 60; // first green; harvest
  if (!isFeastDay || !s.buildings.hall || members.length < 4) return;
  if (s.stock.food < members.length * 2 || sim.day - s.lastRaidedDay < 12) return;

  s.stock.food -= members.length * 0.5;
  const name = doy === 12 ? 'Festival of First Green' : 'Harvest Feast';
  chronicle(sim, 1, `${s.name} held its ${name}`, { x: s.x, y: s.y, kind: 'festival' });
  const present = members.filter(p => dist(p.x, p.y, s.x, s.y) <= 8);
  for (const p of present) {
    p.mood += 0.2;
    p.needs.social = 1;
    remember(p, sim, `danced at the ${name} in ${s.name}`);
  }
  // Everyone rubs shoulders with everyone.
  for (let i = 0; i < present.length; i++) {
    for (let j = i + 1; j < present.length; j++) {
      const bonus = 4 + (present[i].sex !== present[j].sex &&
        present[i].spouse === null && present[j].spouse === null &&
        isAdult(sim, present[i]) && isAdult(sim, present[j]) ? 6 : 0);
      adjustAff(present[i], present[j].id, bonus);
      adjustAff(present[j], present[i].id, bonus);
    }
  }
}

// Generosity between friends: a settlement with a full granary sends a
// trader — a real person, walking real roads — to a hungry neighbor.
function maybeSendTrader(sim, s, members) {
  if (sim.day % 8 !== 3 || members.length < 4 || s.tradeCooldown > 0) return;
  const perHead = s.stock.food / members.length;
  if (perHead < 8) return;
  for (const [otherId, rel] of s.relations) {
    if (rel < -5) continue;                      // no gifts across bad blood
    const other = sim.settlements.get(otherId);
    if (!other || other.members.size === 0) continue;
    if (dist(s.x, s.y, other.x, other.y) > 55) continue;
    if (other.stock.food / other.members.size > 4) continue;
    const trader = members.find(p => isAdult(sim, p) && !p.task && !p.sick && p.traits.diligence > 0.4);
    if (!trader) return;
    const gift = Math.min(20, Math.floor(s.stock.food - members.length * 5));
    if (gift < 5) return;
    s.stock.food -= gift;
    s.tradeCooldown = 20;
    trader.task = { type: 'trade', to: other.id, carrying: gift };
    chronicle(sim, 1, `${displayName(trader)} set out from ${s.name} with food for ${other.name}`,
      { x: s.x, y: s.y, kind: 'trade', who: [trader.id] });
    return;
  }
}

export function completeProject(sim, s) {
  const proj = s.project;
  if (!proj) return;
  s.buildings[proj.type] = (s.buildings[proj.type] || 0) + 1;
  s.project = null;
  if (proj.type === 'dock') {
    const w = waterNear(sim, s, 8);
    s.dockAt = w ? { x: w.x, y: w.y } : null;
  }
  if (proj.type === 'temple') {
    const creed = majorityReligion(sim, s);
    if (creed) {
      s.templeReligion = creed.id;
      chronicle(sim, 2, `${s.name} raised a temple and dedicated it to ${creed.name}`, { x: s.x, y: s.y, kind: 'dedication' });
      return;
    }
  }
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
