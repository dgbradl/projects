// Seeded RNG (mulberry32) + dice helpers.

let s = (Date.now() ^ 0x9e3779b9) >>> 0;

export function seedRng(seed: number) {
  s = seed >>> 0;
}

export function rngState(): number {
  return s;
}

export function rand(): number {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randInt(min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

export function pick<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function d(sides: number): number {
  return randInt(1, sides);
}

export interface RollResult {
  total: number;
  dice: number[];
  sides: number;
  count: number;
  mod: number;
  natural: number;        // sum of dice before mod (for d20s: the kept die)
  crit?: boolean;
  fumble?: boolean;
  adv?: 'adv' | 'dis';
}

/** Roll dice notation like "2d6+1", "1d8", "d20-2". */
export function roll(notation: string): RollResult {
  const m = notation.replace(/\s/g, '').match(/^(\d*)d(\d+)([+-]\d+)?$/i);
  if (!m) throw new Error(`bad dice notation: ${notation}`);
  const count = m[1] ? parseInt(m[1]) : 1;
  const sides = parseInt(m[2]);
  const mod = m[3] ? parseInt(m[3]) : 0;
  const dice: number[] = [];
  for (let i = 0; i < count; i++) dice.push(d(sides));
  const natural = dice.reduce((a, b) => a + b, 0);
  return { total: natural + mod, dice, sides, count, mod, natural };
}

/** d20 roll with optional advantage/disadvantage. */
export function d20(mod: number, adv?: 'adv' | 'dis'): RollResult {
  const a = d(20);
  let natural = a;
  const dice = [a];
  if (adv) {
    const b = d(20);
    dice.push(b);
    natural = adv === 'adv' ? Math.max(a, b) : Math.min(a, b);
  }
  return {
    total: natural + mod, dice, sides: 20, count: 1, mod, natural,
    crit: natural === 20, fumble: natural === 1, adv,
  };
}

export function fmtMod(n: number): string {
  return n >= 0 ? `+${n}` : `${n}`;
}
