// Headless run of the simulation core: sanity, longevity and determinism.
// Usage: node test/headless.js [seed] [years]

import { createSim, tick, stateHash } from '../src/core/sim.js';
import { DAYS_PER_YEAR, yearOf } from '../src/core/world.js';
import { castPower } from '../src/core/god.js';
import { serialize, deserialize } from '../src/core/save.js';

const seed = Number(process.argv[2] ?? 12345);
const years = Number(process.argv[3] ?? 25);

function run(seed, years, verbose) {
  const sim = createSim(seed);
  for (let d = 0; d < years * DAYS_PER_YEAR; d++) {
    tick(sim);
    if (sim.extinct) break;
    if (verbose && sim.day % DAYS_PER_YEAR === 0) {
      const settlements = [...sim.settlements.values()].filter(s => s.members.size > 0);
      const monsters = [...sim.monsters.values()].map(m => m.kind).join(',') || 'none';
      console.log(
        `year ${String(yearOf(sim.day)).padStart(3)}  pop ${String(sim.livingCount).padStart(3)}  ` +
        `settlements ${settlements.length}  faith ${sim.faith.toFixed(0)}  monsters: ${monsters}`);
    }
  }
  return sim;
}

console.log(`— Vale of Embers headless run: seed ${seed}, ${years} years —`);
const sim = run(seed, years, true);

console.log('\n--- final chronicle (major events) ---');
for (const e of sim.chronicleLog.filter(e => e.importance >= 2).slice(-25)) {
  console.log(`Y${e.year} D${e.dayOfYear}: ${e.text}`);
}

console.log('\n--- checks ---');
let failures = 0;
const check = (name, ok) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failures++;
};

check('simulation ran without crashing', true);
check('chronicle recorded history', sim.chronicleLog.length > 10);
check('population is a sane number', sim.livingCount >= 0 && sim.livingCount < 3000);
check('deer herds inhabit the wilds', sim.herds.size > 0);
check('footpaths were worn into the land', sim.world.tiles.some(t => t.traffic > 4));
check('population history recorded', sim.popHistory.length > 100);
if (!sim.extinct) {
  check('some settlement exists (world still alive)',
    [...sim.settlements.values()].some(s => s.members.size > 0));
} else {
  console.log(`note: extinction occurred (a legitimate outcome) after peak pop ${sim.peakPopulation}`);
}

// Religion: a merciful god begets a mercy faith; betrayal begets schism.
// Exact outcomes shift as the sim is rebalanced, so we accept the phenomena
// appearing in ANY of a few deterministic worlds.
{
  let sawMercy = false, sawSchism = false;
  for (const rseed of [2024, 2025, 2026, 2027]) {
    const rsim = createSim(rseed);
    for (let d = 0; d < 8 * DAYS_PER_YEAR && !rsim.extinct; d++) {
      tick(rsim);
      if (rsim.day % 20 === 5) {
        rsim.faith = 999;
        const living = [...rsim.folk.values()].filter(p => p.alive);
        if (living.length) castPower(rsim, 'heal', { person: living[0] });
        const s = [...rsim.settlements.values()].find(s => s.members.size > 0);
        if (s) castPower(rsim, 'bounty', { x: s.x, y: s.y });
      }
    }
    if ([...rsim.religions.values()].some(r => r.doctrine === 'mercy')) sawMercy = true;
    for (let d = 0; d < 8 * DAYS_PER_YEAR && !rsim.extinct; d++) {
      tick(rsim);
      if (rsim.day % 12 === 5) {
        rsim.faith = 999;
        const s = [...rsim.settlements.values()].find(s => s.members.size > 0);
        if (s) castPower(rsim, 'blight', { x: s.x + 3, y: s.y });
      }
    }
    if ([...rsim.religions.values()].some(r => r.doctrine === 'wrath' && r.schismOf !== null)) sawSchism = true;
    if (sawMercy && sawSchism) break;
  }
  check('a faith of mercy arose under a merciful god', sawMercy);
  check('betrayed doctrine led to schism into a cult of dread', sawSchism);
}

// Longevity: an 80-year world must stay bounded in memory and brisk to tick.
{
  const lsim = createSim(4242);
  let totalMs = 0, ticks = 0;
  for (let d = 0; d < 80 * DAYS_PER_YEAR && !lsim.extinct; d++) {
    const t0 = performance.now();
    tick(lsim);
    totalMs += performance.now() - t0;
    ticks++;
  }
  const avgMs = totalMs / ticks;
  console.log(`\n80-year run: pop ${lsim.livingCount} (peak ${lsim.peakPopulation}), ` +
    `avg tick ${avgMs.toFixed(2)}ms, folk records ${lsim.folk.size}, ` +
    `chronicle ${lsim.chronicleLog.length}, obituaries ${lsim.obituaries.length}`);
  check('80 years without crashing', true);
  check('tick stays under 8ms on average', avgMs < 8);
  check('dead are pruned (folk records bounded)', lsim.folk.size < lsim.livingCount + 1000);
  check('chronicle stays bounded', lsim.chronicleLog.length <= 4000);
  check('obituaries stay bounded', lsim.obituaries.length <= 600);
}

// Save/load: a resumed world must continue exactly as the original would.
{
  const original = createSim(555);
  for (let d = 0; d < 3 * DAYS_PER_YEAR; d++) tick(original);
  const snapshot = serialize(original);
  const resumed = deserialize(snapshot);
  check('save/load: state hash matches at load', stateHash(original) === stateHash(resumed));
  for (let d = 0; d < 2 * DAYS_PER_YEAR; d++) { tick(original); tick(resumed); }
  check('save/load: resumed world evolves identically for 2 more years',
    stateHash(original) === stateHash(resumed));
  check('save/load: chronicle continues in the resumed world',
    resumed.chronicleLog.length > 0);
}

// Determinism: identical seeds must produce identical histories.
const a = run(777, 6, false);
const b = run(777, 6, false);
check('determinism: same seed, same state hash', stateHash(a) === stateHash(b));
check('determinism: same chronicle length', a.chronicleLog.length === b.chronicleLog.length);
const c = run(778, 6, false);
check('different seed diverges', stateHash(a) !== stateHash(c) || a.chronicleLog.length !== c.chronicleLog.length);

console.log(failures ? `\n${failures} check(s) FAILED` : '\nall checks passed');
process.exit(failures ? 1 : 0);
