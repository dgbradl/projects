/**
 * Phase 8 (C2): per-archetype behaviour integration tests.
 *
 * Pins the *shape* of the new dwell scaling and zone bias rather than
 * specific snapshot numbers — the underlying RNG draws keep determinism
 * for any given seed, but the population averages over many seeds shift
 * predictably with the trait table.
 */
import { describe, expect, it } from 'vitest';
import type { Npc, NpcArchetype, NpcStatus, ZoneName } from '@shared/types';
import { decideNextState } from '../src/npc/behavior.ts';

const SUBTICKS_PER_DAY = 360;

function makeNpc(input: {
  id: string;
  archetype: NpcArchetype;
  status: NpcStatus;
  zone: ZoneName | null;
}): Npc {
  return {
    id: input.id,
    displayName: input.id,
    status: input.status,
    position: { x: 50, y: 50 },
    zone: input.zone,
    arrivedGameDay: 0,
    arrivedSubTick: 0,
    plannedDepartureGameDay: 999,
    plannedDepartureSubTick: 0,
    nextDecisionSubTick: 0,
    carriedRumorIds: [],
    archetype: input.archetype,
    visitCount: 1,
  };
}

/**
 * Drive an NPC through `n` decision ticks, returning the sequence of dwell
 * lengths (sub-ticks the NPC waits before its next decision). Each call
 * uses a fresh absSubTick so the RNG keying changes per tick.
 */
function dwellsOverTicks(
  startNpc: Npc,
  n: number,
  seedOffset = 0,
): number[] {
  const dwells: number[] = [];
  let npc = startNpc;
  let abs = 10 + seedOffset;
  for (let i = 0; i < n; i += 1) {
    const ctx = {
      absSubTick: abs,
      worldSeed: 'c2-seed',
      subTicksPerDay: SUBTICKS_PER_DAY,
    };
    const { npc: next } = decideNextState(npc, ctx);
    const dwell = next.nextDecisionSubTick - abs;
    dwells.push(dwell);
    npc = { ...next };
    abs += Math.max(1, dwell);
  }
  return dwells;
}

describe('decideNextState — C2 dwell scaling', () => {
  it('refugees dwell less on average than scholars', () => {
    let refugeeTotal = 0;
    let scholarTotal = 0;
    for (let seed = 0; seed < 30; seed += 1) {
      const r = makeNpc({
        id: `r-${seed}`,
        archetype: 'refugee',
        status: 'at_bar',
        zone: 'bar',
      });
      const s = makeNpc({
        id: `s-${seed}`,
        archetype: 'scholar',
        status: 'at_bar',
        zone: 'bar',
      });
      refugeeTotal += dwellsOverTicks(r, 6, seed).reduce((a, b) => a + b, 0);
      scholarTotal += dwellsOverTicks(s, 6, seed).reduce((a, b) => a + b, 0);
    }
    expect(scholarTotal).toBeGreaterThan(refugeeTotal);
  });

  it('clamps minimum dwell to >= 1 so the loop never stalls', () => {
    const dwells = dwellsOverTicks(
      makeNpc({
        id: 'r1',
        archetype: 'refugee', // dwell ×0.7 — could go to 0 without the clamp
        status: 'at_bar',
        zone: 'bar',
      }),
      30,
    );
    for (const d of dwells) {
      expect(d).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('decideNextState — C2 trait-biased zone selection', () => {
  it('bards reach the hearth at all once seated→wandering opens it up', () => {
    // The pre-C2 state machine could never produce 'hearth' as a target;
    // C2 expanded the seated→wandering pool to include hearth. With bard's
    // hearth-heavy preferred zones, this should fire within a small sweep.
    let visitedHearth = false;
    for (let seed = 0; seed < 30 && !visitedHearth; seed += 1) {
      let npc = makeNpc({
        id: `bard-${seed}`,
        archetype: 'bard',
        status: 'seated',
        zone: 'table_a',
      });
      let abs = 10 + seed;
      for (let step = 0; step < 10 && !visitedHearth; step += 1) {
        const { npc: next } = decideNextState(npc, {
          absSubTick: abs,
          worldSeed: 'bard-hearth',
          subTicksPerDay: SUBTICKS_PER_DAY,
        });
        if (next.zone === 'hearth') visitedHearth = true;
        abs = Math.max(abs + 1, next.nextDecisionSubTick);
        npc = next;
      }
    }
    expect(visitedHearth).toBe(true);
  });

  it('rogues choose table corners more than wanderers do', () => {
    const tableA = (npc: Npc) => npc.zone === 'table_a';
    const tableC = (npc: Npc) => npc.zone === 'table_c';

    let rogueCornerHits = 0;
    let wandererCornerHits = 0;
    for (let seed = 0; seed < 40; seed += 1) {
      let r = makeNpc({
        id: `r-${seed}`,
        archetype: 'rogue',
        status: 'at_bar',
        zone: 'bar',
      });
      let w = makeNpc({
        id: `w-${seed}`,
        archetype: 'wanderer',
        status: 'at_bar',
        zone: 'bar',
      });
      // One step takes them from at_bar to a seated table choice.
      const ctx = (s: number) => ({
        absSubTick: 10 + seed * 100 + s,
        worldSeed: 'corner-bias',
        subTicksPerDay: SUBTICKS_PER_DAY,
      });
      r = decideNextState(r, ctx(0)).npc;
      w = decideNextState(w, ctx(1)).npc;
      if (tableA(r) || tableC(r)) rogueCornerHits += 1;
      if (tableA(w) || tableC(w)) wandererCornerHits += 1;
    }
    // Rogue's preferredZones is heavy on table_a + table_c; wanderer is
    // uniform across all three table zones. Over ~40 samples the rogue
    // should land in a corner more often.
    expect(rogueCornerHits).toBeGreaterThan(wandererCornerHits);
  });
});

describe('decideNextState — C2 determinism', () => {
  it('same NPC + seed + absSubTick produces the same decision twice', () => {
    const a = decideNextState(
      makeNpc({
        id: 'd1',
        archetype: 'soldier',
        status: 'wandering',
        zone: 'bar',
      }),
      { absSubTick: 42, worldSeed: 'det', subTicksPerDay: SUBTICKS_PER_DAY },
    );
    const b = decideNextState(
      makeNpc({
        id: 'd1',
        archetype: 'soldier',
        status: 'wandering',
        zone: 'bar',
      }),
      { absSubTick: 42, worldSeed: 'det', subTicksPerDay: SUBTICKS_PER_DAY },
    );
    expect(a.npc.zone).toBe(b.npc.zone);
    expect(a.npc.status).toBe(b.npc.status);
    expect(a.npc.nextDecisionSubTick).toBe(b.npc.nextDecisionSubTick);
  });
});
