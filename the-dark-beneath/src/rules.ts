// Shadowdark-inspired rules: checks, character math, generation, advancement.
import type { Character, ClassName, Item, Stat } from './types';
import { STATS } from './types';
import { d20, pick, randInt, roll, d } from './rng';
import { ITEMS, NAMES, ANCESTRIES, CLASS_SPELLS, SPELLS } from './data';
import { log, logRoll } from './log';
import { sfx } from './sound';

export function mod(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function statMod(c: Character, s: Stat): number {
  return mod(c.stats[s]);
}

// ---------- derived ----------

export function armorClass(c: Character): number {
  let ac = 10;
  let dex = statMod(c, 'DEX');
  if (c.armor) {
    ac = c.armor.ac ?? 10;
    if (c.armor.noDex) dex = 0;
  }
  return ac + dex + (c.shield?.ac ?? 0);
}

export function attackMod(c: Character): number {
  const w = c.weapon;
  const useDex = w ? (w.ranged || (w.finesse && statMod(c, 'DEX') > statMod(c, 'STR'))) : false;
  const stat = useDex ? statMod(c, 'DEX') : statMod(c, 'STR');
  const prof = c.cls === 'Fighter' ? c.level : Math.floor(c.level / 2);
  return stat + prof + (c.blessed ? 1 : 0);
}

export function damageDice(c: Character): string {
  return c.weapon?.dmg ?? '1d2'; // fists
}

export function damageBonus(c: Character): number {
  // Fighters are masters of their arms: +1 damage.
  return c.cls === 'Fighter' ? 1 : 0;
}

export function gearSlots(c: Character): number {
  return Math.max(c.stats.STR, 10);
}

export function slotsUsed(c: Character): number {
  let n = c.gear.reduce((a, i) => a + i.slots, 0);
  if (c.weapon) n += c.weapon.slots;
  if (c.armor) n += c.armor.slots;
  if (c.shield) n += c.shield.slots;
  return n;
}

export function xpToLevel(level: number): number {
  return level * 10;
}

// ---------- checks ----------

export const DC = { easy: 9, normal: 12, hard: 15, extreme: 18 } as const;

export function check(c: Character, stat: Stat, dc: number, what: string, adv?: 'adv' | 'dis'): boolean {
  const r = d20(statMod(c, stat), adv);
  const ok = r.total >= dc && !r.fumble;
  logRoll({ who: c.name, what: `${what} (${stat})`, roll: r, vs: dc, outcome: ok ? 'Success' : 'Failure', success: ok });
  return ok;
}

// ---------- character generation ----------

let charCounter = 0;

export function rollStatBlock(): Record<Stat, number> {
  const stats: Record<Stat, number> = { STR: 0, DEX: 0, CON: 0, INT: 0, WIS: 0, CHA: 0 };
  for (const s of STATS) stats[s] = d(6) + d(6) + d(6);
  return stats;
}

export function primeStat(cls: ClassName): Stat {
  return cls === 'Fighter' ? 'STR' : cls === 'Thief' ? 'DEX' : cls === 'Priest' ? 'WIS' : 'INT';
}

export interface BuildOpts {
  name: string;
  ancestry: Character['ancestry'];
  cls: ClassName;
  stats: Record<Stat, number>;
  spellChoice?: string;   // priest: bless/turn_undead · wizard: burning_hands/sleep
  nudge?: boolean;        // NPC generation: guarantee a respectable prime stat
}

export function makeCharacter(o: BuildOpts): Character {
  const stats = { ...o.stats };
  const prime = primeStat(o.cls);
  if (o.nudge && stats[prime] < 13) stats[prime] = 13 + randInt(0, 2);
  if (o.ancestry === 'Human') stats[prime] += 1;

  const hd = o.cls === 'Fighter' ? 8 : o.cls === 'Priest' ? 6 : 4;
  const maxHp = Math.max(1, d(hd) + mod(stats.CON)) + (o.ancestry === 'Dwarf' ? 2 : 0);

  const c: Character = {
    id: `c${Date.now().toString(36)}${charCounter++}`,
    name: o.name, ancestry: o.ancestry, cls: o.cls, level: 1, xp: 0,
    stats, hp: maxHp, maxHp,
    spells: {}, gear: [], alive: true,
  };

  // starting kit
  give(c, 'torch'); give(c, 'ration');
  switch (o.cls) {
    case 'Fighter':
      c.weapon = { ...ITEMS[pick(['longsword', 'greataxe', 'spear'])] };
      c.armor = { ...ITEMS['chainmail'] };
      if (!c.weapon.twoHanded) c.shield = { ...ITEMS['shield'] };
      break;
    case 'Thief':
      c.weapon = { ...ITEMS[pick(['dagger', 'shortsword'])] };
      c.armor = { ...ITEMS['leather'] };
      give(c, 'crowbar');
      break;
    case 'Priest':
      c.weapon = { ...ITEMS['mace'] };
      c.armor = { ...ITEMS['leather'] };
      c.shield = { ...ITEMS['shield'] };
      c.spells['cure_wounds'] = true;
      c.spells[o.spellChoice ?? pick(['bless', 'turn_undead'])] = true;
      break;
    case 'Wizard':
      c.weapon = { ...ITEMS[pick(['staff', 'dagger'])] };
      c.spells['magic_missile'] = true;
      c.spells[o.spellChoice ?? pick(['burning_hands', 'sleep'])] = true;
      give(c, 'scroll_mm');
      break;
  }
  return c;
}

export function generateCharacter(cls?: ClassName, level = 1): Character {
  const stats = rollStatBlock();
  const ancestry = pick(ANCESTRIES).name;
  const chosen: ClassName = cls ?? bestClass(stats);
  const c = makeCharacter({ name: pick(NAMES[ancestry]), ancestry, cls: chosen, stats, nudge: true });
  for (let l = 1; l < level; l++) levelUp(c, true);
  return c;
}

export function bestClass(stats: Record<Stat, number>): ClassName {
  const options: [ClassName, number][] = [
    ['Fighter', stats.STR], ['Thief', stats.DEX], ['Priest', stats.WIS], ['Wizard', stats.INT],
  ];
  options.sort((a, b) => b[1] - a[1]);
  return options[0][0];
}

export function give(c: Character, itemId: string): Item {
  const it = { ...ITEMS[itemId] };
  c.gear.push(it);
  return it;
}

export function generateParty(): Character[] {
  return [
    generateCharacter('Fighter'),
    generateCharacter('Thief'),
    generateCharacter('Priest'),
    generateCharacter('Wizard'),
  ];
}

// ---------- advancement ----------

export function grantXp(party: Character[], amount: number) {
  const living = party.filter(p => p.alive);
  if (!living.length) return;
  const each = Math.max(1, Math.round(amount / living.length));
  for (const p of living) {
    const gained = p.ancestry === 'Human' ? Math.round(each * 1.1) : each;
    p.xp += gained;
    while (p.xp >= xpToLevel(p.level)) {
      p.xp -= xpToLevel(p.level);
      levelUp(p);
    }
  }
  log(`The party gains ${amount} XP.`, 'info');
}

export function levelUp(c: Character, silent = false) {
  c.level++;
  const hd = c.cls === 'Fighter' ? 8 : c.cls === 'Priest' ? 6 : 4;
  const gain = Math.max(1, d(hd) + mod(c.stats.CON));
  c.maxHp += gain;
  c.hp += gain;
  // casters learn a new spell at each level
  if (c.cls === 'Priest' || c.cls === 'Wizard') {
    const known = Object.keys(c.spells);
    const candidates = CLASS_SPELLS[c.cls].filter(id => !known.includes(id) && SPELLS[id].tier <= Math.ceil(c.level / 2));
    if (candidates.length) {
      const learned = pick(candidates);
      c.spells[learned] = true;
      if (!silent) log(`${c.name} learns ${SPELLS[learned].name}!`, 'good');
    }
  }
  if (!silent) {
    log(`⬆ ${c.name} reaches level ${c.level}! (+${gain} HP)`, 'good');
    sfx('levelup');
  }
}

// ---------- healing / rest ----------

export function heal(c: Character, amount: number) {
  c.hp = Math.min(c.maxHp, c.hp + amount);
}

export function fullRest(party: Character[]) {
  for (const p of party) {
    if (!p.alive) continue;
    p.hp = p.maxHp;
    p.dyingRounds = undefined;
    p.blessed = false;
    for (const id of Object.keys(p.spells)) p.spells[id] = true;
  }
}
