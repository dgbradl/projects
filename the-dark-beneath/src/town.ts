// Emberwick: inn, shop, temple, tavern recruits, notice board.
import { G, hooks, saveGame } from './state';
import { ITEMS } from './data';
import { fullRest, generateCharacter, gearSlots, slotsUsed } from './rules';
import { log, logDivider } from './log';
import { sfx } from './sound';
import { pick } from './rng';

export const PRICES = { rest: 8, templeHeal: 15, templeBless: 25, hire: 25 };

export function restAtInn(): boolean {
  if (G.gold < PRICES.rest) { log('The innkeep shakes her head. No coin, no bed.', 'bad'); return false; }
  G.gold -= PRICES.rest;
  G.day++;
  fullRest(G.party);
  refreshRecruits();
  sfx('heal');
  log('Hot stew, a real fire, straw beds. You sleep like the honest dead and wake whole. (Party fully restored, spells recovered.)', 'good');
  saveGame();
  hooks.refresh();
  return true;
}

export function templeHeal(): boolean {
  if (G.gold < PRICES.templeHeal) { log('The acolyte smiles apologetically at your empty purse.', 'bad'); return false; }
  G.gold -= PRICES.templeHeal;
  for (const p of G.party) if (p.alive) { p.hp = p.maxHp; p.dyingRounds = undefined; }
  sfx('heal');
  log('Incense, cool hands, murmured prayers. Your wounds close. (Party healed to full.)', 'good');
  hooks.refresh();
  return true;
}

export function templeBless(): boolean {
  if (G.gold < PRICES.templeBless) { log('Blessings, alas, are not free. The roof does not fix itself.', 'bad'); return false; }
  G.gold -= PRICES.templeBless;
  for (const p of G.party) if (p.alive) p.blessed = true;
  sfx('heal');
  log('The old priest anoints each brow with oil. You carry the light with you. (+1 to attacks until after your next fight.)', 'good');
  hooks.refresh();
  return true;
}

export function refreshRecruits() {
  const avgLevel = Math.max(1, Math.round(G.party.reduce((a, p) => a + p.level, 0) / Math.max(1, G.party.length)) - 0);
  G.recruits = [
    generateCharacter(undefined, Math.max(1, avgLevel - 1)),
    generateCharacter(undefined, Math.max(1, avgLevel - 1)),
  ];
}

export function hireRecruit(idx: number): boolean {
  if (G.party.length >= 4) { log('Your company is full. Four is company; five is a funeral queue.', 'system'); return false; }
  if (G.gold < PRICES.hire) { log('They size up your purse and go back to their drink.', 'bad'); return false; }
  const r = G.recruits[idx];
  if (!r) return false;
  G.gold -= PRICES.hire;
  G.recruits.splice(idx, 1);
  G.party.push(r);
  log(`${r.name} the ${r.ancestry} ${r.cls} drains their cup and stands. "When do we leave?"`, 'good');
  hooks.refresh();
  return true;
}

export function buyItem(itemId: string, charId?: string): boolean {
  const item = ITEMS[itemId];
  if (!item || G.gold < item.cost) { log('Not enough gold.', 'bad'); return false; }

  if (item.kind === 'torch') { G.gold -= item.cost; G.torches++; sfx('loot'); log('You buy a torch.', 'loot'); hooks.refresh(); return true; }
  if (item.id === 'ration') { G.gold -= item.cost; G.rations += 3; log('You buy three days of rations.', 'loot'); hooks.refresh(); return true; }

  const c = G.party.find(p => p.id === charId) ?? G.party[0];
  if (!c) return false;

  if (item.kind === 'weapon' || item.kind === 'armor' || item.kind === 'shield') {
    G.gold -= item.cost;
    const slot = item.kind === 'weapon' ? 'weapon' : item.kind === 'armor' ? 'armor' : 'shield';
    const old = c[slot as 'weapon' | 'armor' | 'shield'];
    if (old) { G.gold += Math.floor(old.cost / 2); log(`${c.name} trades in the old ${old.name} (+${Math.floor(old.cost / 2)} gp).`, 'loot'); }
    (c as any)[slot] = { ...item };
    log(`${c.name} now carries a ${item.name}.`, 'loot');
    hooks.refresh();
    return true;
  }

  if (slotsUsed(c) + item.slots > gearSlots(c)) { log(`${c.name} can't carry any more.`, 'bad'); return false; }
  G.gold -= item.cost;
  c.gear.push({ ...item });
  log(`${c.name} buys a ${item.name}.`, 'loot');
  hooks.refresh();
  return true;
}

export function sellGear(charId: string, gearIdx: number): boolean {
  const c = G.party.find(p => p.id === charId);
  if (!c) return false;
  const item = c.gear[gearIdx];
  if (!item) return false;
  const price = item.kind === 'treasure' ? (item.value ?? 0) : Math.floor(item.cost / 2);
  c.gear.splice(gearIdx, 1);
  G.gold += price;
  sfx('loot');
  log(`Sold ${item.name} for ${price} gp.${item.kind === 'treasure' ? ' The merchant\'s eyes gleam.' : ''}`, 'loot');
  hooks.refresh();
  return true;
}

export function collectBounties() {
  let any = false;
  for (const q of G.quests) {
    if (!q.done && G.flags[q.target]) q.done = true;
    if (q.done && !q.paid) {
      q.paid = true;
      G.gold += q.reward;
      any = true;
      sfx('loot');
      logDivider('BOUNTY PAID');
      log(`"${q.title}" — complete! The town pays ${q.reward} gp, and ${pick(['a round of drinks appears from nowhere', 'someone starts a song about you; it needs work', 'children follow you down the street', 'the mayor shakes every hand twice'])}.`, 'good');
    }
  }
  if (!any) log('The notice board rustles in the wind. Work is posted; heroes are scarce.', 'gm');
  if (G.quests.every(q => q.paid)) {
    logDivider('THE DARK RECEDES');
    log('Every bounty settled, every horror named and buried. Emberwick\'s lanterns burn a little softer now — for the first time in living memory, out of comfort rather than fear. Your legend is only beginning.', 'good');
  }
  hooks.refresh();
}
