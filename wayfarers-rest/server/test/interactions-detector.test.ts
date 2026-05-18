import { describe, expect, it } from 'vitest';
import type { Npc } from '@shared/types';
import { detectInteractions } from '../src/interactions/detector.ts';

function npc(id: string, zone: Npc['zone']): Npc {
  return {
    id,
    displayName: id,
    status: 'seated',
    position: { x: 50, y: 50 },
    zone,
    arrivedGameDay: 1,
    arrivedSubTick: 0,
    plannedDepartureGameDay: 2,
    plannedDepartureSubTick: 0,
    nextDecisionSubTick: 100,
    carriedRumorIds: [],
  };
}

function newCtx() {
  return {
    worldSeed: 'detect-seed',
    gameDay: 1,
    subTick: 0,
    countsToday: new Map<string, number>(),
    pairsToday: new Set<string>(),
  };
}

describe('detectInteractions', () => {
  it('NPCs in different zones never interact', () => {
    const ctx = newCtx();
    const out: ReturnType<typeof detectInteractions>[] = [];
    for (let st = 0; st < 200; st += 1) {
      const c = detectInteractions(
        [npc('a', 'table_a'), npc('b', 'table_b')],
        { ...ctx, subTick: st },
      );
      out.push(c);
    }
    expect(out.every((c) => c.length === 0)).toBe(true);
  });

  it('caps a pair at one interaction per day even with many opportunities', () => {
    const ctx = newCtx();
    let totalForPair = 0;
    for (let st = 0; st < 200; st += 1) {
      const c = detectInteractions(
        [npc('a', 'bar'), npc('b', 'bar')],
        { ...ctx, subTick: st },
      );
      totalForPair += c.length;
    }
    expect(totalForPair).toBeLessThanOrEqual(1);
  });

  it('produces an interaction for an eligible pair within a reasonable window', () => {
    // Sample many pairs with distinct ids so detector RNG gets varied seeds;
    // by 50 sub-ticks of opportunity per pair, expect at least one hit.
    const ctx = newCtx();
    let totalHits = 0;
    for (let pair = 0; pair < 20; pair += 1) {
      const a = npc(`a${pair}`, 'bar');
      const b = npc(`b${pair}`, 'bar');
      for (let st = 0; st < 80; st += 1) {
        const c = detectInteractions([a, b], { ...ctx, subTick: st });
        totalHits += c.length;
      }
    }
    expect(totalHits).toBeGreaterThan(0);
  });
});
