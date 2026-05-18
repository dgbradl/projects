export type Rng = () => number;

/**
 * FNV-1a hash, 32-bit. Stable across runs and platforms.
 */
function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Mulberry32 — a fast, well-distributed 32-bit PRNG.
 * Returns floats in [0, 1).
 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a deterministic RNG from a list of namespaced parts.
 * Identical parts always produce the identical sequence.
 */
export function seededRng(...parts: (string | number)[]): Rng {
  return mulberry32(fnv1a(parts.map((p) => String(p)).join('|')));
}

export function rngInt(rng: Rng, minInclusive: number, maxExclusive: number): number {
  return minInclusive + Math.floor(rng() * (maxExclusive - minInclusive));
}

export function rngFloat(rng: Rng, minInclusive: number, maxExclusive: number): number {
  return minInclusive + rng() * (maxExclusive - minInclusive);
}

export function rngPick<T>(rng: Rng, items: readonly T[]): T {
  if (items.length === 0) throw new Error('rngPick: empty array');
  return items[Math.floor(rng() * items.length)];
}
