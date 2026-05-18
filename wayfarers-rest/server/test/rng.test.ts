import { describe, expect, it } from 'vitest';
import {
  mulberry32,
  rngInt,
  rngPick,
  seededRng,
} from '../src/world/rng.ts';

describe('seededRng', () => {
  it('produces identical sequences for identical inputs', () => {
    const a = seededRng('world-seed', 'spawn', 5);
    const b = seededRng('world-seed', 'spawn', 5);
    const seqA = Array.from({ length: 8 }, () => a());
    const seqB = Array.from({ length: 8 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('diverges for different inputs', () => {
    const a = seededRng('world-seed', 'spawn', 5);
    const b = seededRng('world-seed', 'spawn', 6);
    expect(a()).not.toBe(b());
  });

  it('mulberry32 produces values in [0, 1)', () => {
    const rng = mulberry32(42);
    for (let i = 0; i < 100; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('rngInt respects the half-open range', () => {
    const rng = seededRng('test', 'int');
    for (let i = 0; i < 100; i += 1) {
      const v = rngInt(rng, 4, 11);
      expect(v).toBeGreaterThanOrEqual(4);
      expect(v).toBeLessThanOrEqual(10);
    }
  });

  it('rngPick returns an element of the input array', () => {
    const rng = seededRng('test', 'pick');
    const items = ['a', 'b', 'c', 'd'];
    for (let i = 0; i < 20; i += 1) {
      expect(items).toContain(rngPick(rng, items));
    }
  });
});
