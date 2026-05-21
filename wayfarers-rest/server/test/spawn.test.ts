import { describe, expect, it } from 'vitest';
import { PLACEHOLDER_NAMES } from '../src/data/placeholderNames.ts';
import { generateDeparture, generateSpawnQueue } from '../src/npc/spawn.ts';

const SUB_TICKS_PER_DAY = 360;

describe('generateSpawnQueue', () => {
  it('is deterministic for a given (seed, day)', () => {
    const a = generateSpawnQueue({
      worldSeed: 'fixed-seed',
      gameDay: 5,
      subTicksPerDay: SUB_TICKS_PER_DAY,
    });
    const b = generateSpawnQueue({
      worldSeed: 'fixed-seed',
      gameDay: 5,
      subTicksPerDay: SUB_TICKS_PER_DAY,
    });
    expect(a).toEqual(b);
  });

  it('returns 4-10 arrivals', () => {
    for (let day = 1; day <= 30; day += 1) {
      const queue = generateSpawnQueue({
        worldSeed: 'fixed-seed',
        gameDay: day,
        subTicksPerDay: SUB_TICKS_PER_DAY,
      });
      expect(queue.length).toBeGreaterThanOrEqual(4);
      expect(queue.length).toBeLessThanOrEqual(10);
    }
  });

  it('scheduled sub-ticks are in [0, subTicksPerDay) and sorted ascending', () => {
    for (let day = 1; day <= 10; day += 1) {
      const queue = generateSpawnQueue({
        worldSeed: 'fixed-seed',
        gameDay: day,
        subTicksPerDay: SUB_TICKS_PER_DAY,
      });
      for (const arrival of queue) {
        expect(arrival.scheduledSubTick).toBeGreaterThanOrEqual(0);
        expect(arrival.scheduledSubTick).toBeLessThan(SUB_TICKS_PER_DAY);
      }
      for (let i = 1; i < queue.length; i += 1) {
        expect(queue[i].scheduledSubTick).toBeGreaterThanOrEqual(
          queue[i - 1].scheduledSubTick,
        );
      }
    }
  });

  it('names within a single day do not duplicate', () => {
    for (let day = 1; day <= 30; day += 1) {
      const queue = generateSpawnQueue({
        worldSeed: 'fixed-seed',
        gameDay: day,
        subTicksPerDay: SUB_TICKS_PER_DAY,
      });
      const names = queue.map((q) => q.displayName);
      expect(new Set(names).size).toBe(names.length);
      for (const name of names) {
        expect(PLACEHOLDER_NAMES).toContain(name);
      }
    }
  });

  it('a festival underway adds arrivals to the queue', () => {
    const base = generateSpawnQueue({
      worldSeed: 'fixed-seed',
      gameDay: 5,
      subTicksPerDay: SUB_TICKS_PER_DAY,
    });
    const withFestival = generateSpawnQueue({
      worldSeed: 'fixed-seed',
      gameDay: 5,
      subTicksPerDay: SUB_TICKS_PER_DAY,
      worldTags: [{ key: 'festival', value: 'underway', setOnGameDay: 1 }],
    });
    expect(withFestival.length).toBe(base.length + 3);
  });

  it('different seeds produce different queues', () => {
    const a = generateSpawnQueue({
      worldSeed: 'seed-A',
      gameDay: 1,
      subTicksPerDay: SUB_TICKS_PER_DAY,
    });
    const b = generateSpawnQueue({
      worldSeed: 'seed-B',
      gameDay: 1,
      subTicksPerDay: SUB_TICKS_PER_DAY,
    });
    expect(a).not.toEqual(b);
  });

  it('npcIds follow npc_d{day}_{idx} format and are unique', () => {
    const queue = generateSpawnQueue({
      worldSeed: 'fixed-seed',
      gameDay: 7,
      subTicksPerDay: SUB_TICKS_PER_DAY,
    });
    const ids = queue.map((q) => q.npcId);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(/^npc_d7_\d+$/);
    }
    // Every index in [0, count) is present somewhere in the queue.
    const indices = ids.map((id) => Number(id.split('_').pop()));
    indices.sort((a, b) => a - b);
    expect(indices).toEqual([...Array(queue.length).keys()]);
  });
});

describe('generateDeparture', () => {
  it('returns a stay of 40-200 sub-ticks past arrival', () => {
    for (let i = 0; i < 50; i += 1) {
      const dep = generateDeparture({
        worldSeed: 'seed',
        npcId: `npc_d1_${i}`,
        arrivedAbsoluteSubTick: 100,
        subTicksPerDay: SUB_TICKS_PER_DAY,
      });
      const departAbs =
        dep.plannedDepartureGameDay * SUB_TICKS_PER_DAY +
        dep.plannedDepartureSubTick;
      const stay = departAbs - 100;
      expect(stay).toBeGreaterThanOrEqual(40);
      expect(stay).toBeLessThanOrEqual(200);
    }
  });

  it('is deterministic per npcId', () => {
    const a = generateDeparture({
      worldSeed: 'seed',
      npcId: 'npc_d1_0',
      arrivedAbsoluteSubTick: 50,
      subTicksPerDay: SUB_TICKS_PER_DAY,
    });
    const b = generateDeparture({
      worldSeed: 'seed',
      npcId: 'npc_d1_0',
      arrivedAbsoluteSubTick: 50,
      subTicksPerDay: SUB_TICKS_PER_DAY,
    });
    expect(a).toEqual(b);
  });
});
