// Overworld travel between world nodes, with random encounters.
import { G, hooks } from './state';
import { WORLD, ENCOUNTERS, TRAVEL_FLAVOR, TOWN_FLAVOR } from './data';
import { pick, rand, roll } from './rng';
import { log, logDivider } from './log';
import { startCombat, spawnMonsters } from './combat';

export function currentNode() {
  return WORLD[G.location];
}

export function canTravelTo(nodeId: string): boolean {
  return currentNode().links.includes(nodeId);
}

export function travelTo(nodeId: string) {
  if (G.mode !== 'overworld' && G.mode !== 'town') return;
  if (!canTravelTo(nodeId)) return;
  const dest = WORLD[nodeId];
  log(`You take the road toward ${dest.name}.`, 'gm');
  if (rand() < 0.5) log(pick(TRAVEL_FLAVOR), 'gm');

  G.location = nodeId;
  G.mode = 'overworld';

  // random encounter en route?
  const chance = 0.15 + dest.tier * 0.08;
  if (rand() < chance) {
    const table = ENCOUNTERS[dest.tier] ?? ENCOUNTERS[1];
    const e = pick(table);
    const n = roll(e.count.includes('d') ? e.count : `1d1+${parseInt(e.count) - 1}`).total;
    logDivider('AMBUSH ON THE ROAD');
    log('Movement in the treeline — weapons out!', 'bad');
    startCombat(spawnMonsters(e.defId, n), { theme: 'road', travel: true });
    return;
  }

  arrive();
  hooks.refresh();
}

export function arrive() {
  const node = currentNode();
  logDivider(node.name);
  log(node.desc, 'gm');
  if (node.kind === 'town') {
    G.mode = 'town';
    log(pick(TOWN_FLAVOR), 'gm');
  }
}
