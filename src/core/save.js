// Save and load: a world serialized down to the last grudge, so it can be
// put away and resumed exactly where it left off. Static geography (biomes,
// elevation, fertility) is regenerated from the seed; only mutable state is
// stored.

import { createSim } from './sim.js';


function packPerson(p) {
  return {
    id: p.id, name: p.name, surname: p.surname ?? null, sex: p.sex, bornDay: p.bornDay,
    alive: p.alive, causeOfDeath: p.causeOfDeath, diedDay: p.diedDay ?? null,
    x: p.x, y: p.y, home: p.home,
    traits: p.traits, needs: p.needs, mood: p.mood, health: p.health,
    sick: p.sick, sickDays: p.sickDays, injured: p.injured,
    skills: p.skills,
    // aff-0, kinless entries are recreated on demand and can be dropped safely
    rel: [...p.rel.entries()].filter(([, r]) => r.aff !== 0 || r.kin),
    spouse: p.spouse, pregnantDays: p.pregnantDays, pregnantBy: p.pregnantBy,
    carriedFood: p.carriedFood, carriedTrade: p.carriedTrade ?? 0,
    task: p.task, memories: p.memories, inspired: p.inspired,
    fame: p.fame, epithet: p.epithet, wolfPacksSlain: p.wolfPacksSlain,
    murders: p.murders, religion: p.religion,
    outlaw: p.outlaw ?? false, homelessDays: p.homelessDays ?? 0,
    lastPilgrimage: p.lastPilgrimage ?? null,
  };
}

function unpackPerson(d) {
  return {
    ...d,
    surname: d.surname ?? null,
    px: d.x, py: d.y,
    skills: { fish: 0.2, ...d.skills },
    rel: new Map(d.rel),
    carriedTrade: d.carriedTrade ?? 0,
    activity: null, tendedToday: false, prayedToday: false,
  };
}

function packSettlement(s) {
  return {
    id: s.id, name: s.name, x: s.x, y: s.y,
    founderId: s.founderId, foundedDay: s.foundedDay, chiefId: s.chiefId ?? null,
    members: [...s.members],
    stock: { food: s.stock.food, wood: s.stock.wood, stone: s.stock.stone, wool: s.stock.wool ?? 0 },
    buildings: { dock: 0, pen: 0, ...s.buildings }, project: s.project, dockAt: s.dockAt ?? null,
    sheep: s.sheep ?? 0,
    relations: [...s.relations.entries()],
    lastRaidedDay: s.lastRaidedDay, raidCooldown: s.raidCooldown,
    robbedCount: s.robbedCount ?? 0, wantedId: s.wantedId ?? null,
    tradeCooldown: s.tradeCooldown ?? 0, fallen: s.fallen,
    templeReligion: s.templeReligion,
  };
}

function unpackSettlement(d) {
  return {
    ...d,
    members: new Set(d.members),
    relations: new Map(d.relations),
    stock: { wool: 0, ...d.stock },
    sheep: d.sheep ?? 0,
    tradeCooldown: d.tradeCooldown ?? 0,
  };
}

export function serialize(sim) {
  return JSON.stringify({
    v: 1,
    seed: sim.seed,
    rng: sim.rng.getState(),
    day: sim.day,
    tiles: sim.world.tiles.map(t => [t.food, t.wood, t.stone, t.blight, t.bounty, t.traffic]),
    folk: [...sim.folk.values()].map(packPerson),
    settlements: [...sim.settlements.values()].map(packSettlement),
    monsters: [...sim.monsters.values()],
    herds: [...sim.herds.values()],
    religions: [...sim.religions.values()],
    shrines: [...sim.shrines.values()],
    chronicle: sim.chronicleLog.slice(-1500),
    faith: sim.faith,
    faithWitnessed: sim.faithWitnessed,
    godDeeds: { mercy: sim.godDeeds.mercy, wrath: sim.godDeeds.wrath },
    lastDeedDay: sim.lastDeedDay,
    nextId: sim.nextId,
    livingCount: sim.livingCount,
    peakPopulation: sim.peakPopulation,
    popHistory: sim.popHistory,
    plague: sim.plague,
    weather: sim.weather,
    extinct: sim.extinct,
  });
}

export function deserialize(json) {
  const d = typeof json === 'string' ? JSON.parse(json) : json;
  // Recreate the world's bones from the seed, then discard the fresh start.
  const sim = createSim(d.seed);
  sim.folk.clear();
  sim.settlements.clear();
  sim.monsters.clear();
  sim.herds.clear();
  sim.religions.clear();
  sim.chronicleLog.length = 0;

  sim.rng.setState(d.rng);
  sim.day = d.day;
  d.tiles.forEach(([food, wood, stone, blight, bounty, traffic], i) => {
    const t = sim.world.tiles[i];
    t.food = food; t.wood = wood; t.stone = stone;
    t.blight = blight; t.bounty = bounty; t.traffic = traffic;
  });
  for (const pd of d.folk) sim.folk.set(pd.id, unpackPerson(pd));
  for (const sd of d.settlements) sim.settlements.set(sd.id, unpackSettlement(sd));
  for (const m of d.monsters) sim.monsters.set(m.id, { ...m });
  for (const h of d.herds) sim.herds.set(h.id, { ...h });
  for (const r of d.religions) sim.religions.set(r.id, { ...r });
  sim.shrines.clear();
  for (const sh of d.shrines ?? []) sim.shrines.set(sh.id, { ...sh });
  sim.chronicleLog.push(...d.chronicle);
  sim.faith = d.faith;
  sim.faithWitnessed = d.faithWitnessed;
  sim.godDeeds = d.godDeeds;
  sim.lastDeedDay = d.lastDeedDay;
  sim.nextId = d.nextId;
  sim.livingCount = d.livingCount;
  sim.peakPopulation = d.peakPopulation;
  sim.popHistory = d.popHistory;
  sim.plague = d.plague;
  sim.weather = d.weather;
  sim.extinct = d.extinct;
  return sim;
}
