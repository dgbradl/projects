import { describe, expect, it } from 'vitest';
import type { FurniturePiece, Npc, Zone } from '@shared/types';
import {
  CHAIR_HW,
  chairsInZone,
  pickFreeChair,
  positionBesideChair,
  zoneCentroidOfOthers,
} from '../src/npc/seating.ts';
import { pickPositionInZone } from '../src/npc/behavior.ts';
import { seededRng } from '../src/world/rng.ts';

function piece(overrides: Partial<FurniturePiece> & { id: string }): FurniturePiece {
  return {
    id: overrides.id,
    sprite: overrides.sprite ?? 'chair_01',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    rotation: overrides.rotation ?? 0,
    scale: overrides.scale ?? 1,
    layer: overrides.layer ?? 1,
  };
}

function npc(overrides: Partial<Npc> & { id: string }): Npc {
  return {
    id: overrides.id,
    displayName: overrides.displayName ?? 'Test',
    archetype: overrides.archetype ?? 'wanderer',
    status: overrides.status ?? 'seated',
    zone: overrides.zone ?? 'table_a',
    position: overrides.position ?? { x: 30, y: 60 },
    nextDecisionSubTick: overrides.nextDecisionSubTick ?? 0,
    arrivedGameDay: overrides.arrivedGameDay ?? 1,
    arrivedSubTick: overrides.arrivedSubTick ?? 0,
    carriedRumorIds: overrides.carriedRumorIds ?? [],
    visitCount: overrides.visitCount ?? 1,
    isStaff: overrides.isStaff ?? false,
  } as Npc;
}

const tableA: Zone = { name: 'table_a', x: 30, y: 60, radius: 7 };

describe('chairsInZone', () => {
  it('returns chairs whose center sits inside zone.radius + CHAIR_HW', () => {
    const furniture = [
      piece({ id: 'c1', sprite: 'chair_01', x: 30, y: 60 }), // dead-center
      piece({ id: 'c2', sprite: 'chair_02', x: 34, y: 62 }), // inside
      piece({ id: 'far', sprite: 'chair_03', x: 80, y: 80 }), // far away
      piece({ id: 't', sprite: 'table_round_01', x: 30, y: 60 }), // not a chair
    ];
    const result = chairsInZone(tableA, furniture);
    expect(result.map((p) => p.id).sort()).toEqual(['c1', 'c2']);
  });

  it('returns empty when no chairs are placed', () => {
    expect(chairsInZone(tableA, [])).toEqual([]);
    expect(chairsInZone(tableA, [piece({ id: 't', sprite: 'table_rect_01' })])).toEqual([]);
  });
});

describe('pickFreeChair', () => {
  it('skips chairs already occupied by another NPC', () => {
    // CHAIR_HW = 4 → chairs need to be > 8 apart so one occupant only
    // blocks one chair, not its neighbour.
    const chairs = [
      piece({ id: 'c1', sprite: 'chair_01', x: 28, y: 60 }),
      piece({ id: 'c2', sprite: 'chair_02', x: 36, y: 60 }), // 8 from c1; > CHAIR_HW
    ];
    const roster = [npc({ id: 'sitting', position: { x: 28, y: 60 } })];
    const rng = seededRng('seat-seed', 'pick');
    const chosen = pickFreeChair(tableA, chairs, roster, rng, 'self');
    expect(chosen?.id).toBe('c2');
  });

  it('returns null when every chair is taken', () => {
    const chairs = [
      piece({ id: 'c1', sprite: 'chair_01', x: 28, y: 60 }),
      piece({ id: 'c2', sprite: 'chair_02', x: 36, y: 60 }),
    ];
    const roster = [
      npc({ id: 'a', position: { x: 28, y: 60 } }),
      npc({ id: 'b', position: { x: 36, y: 60 } }),
    ];
    const rng = seededRng('seat-seed', 'pick');
    expect(pickFreeChair(tableA, chairs, roster, rng, 'self')).toBeNull();
  });

  it('does not count the NPC itself as an occupant', () => {
    const chairs = [piece({ id: 'c1', sprite: 'chair_01', x: 30, y: 60 })];
    const roster = [npc({ id: 'self', position: { x: 30, y: 60 } })];
    const rng = seededRng('seat-seed', 'pick');
    // 'self' is at the chair — but it's the one looking, so chair is free.
    expect(pickFreeChair(tableA, chairs, roster, rng, 'self')?.id).toBe('c1');
  });
});

describe('positionBesideChair', () => {
  it('places the NPC just outside the chair bbox', () => {
    const chair = piece({ id: 'c', sprite: 'chair_01', x: 30, y: 60 });
    const rng = seededRng('seat-seed', 'beside');
    const p = positionBesideChair(chair, rng);
    const dist = Math.hypot(p.x - chair.x, p.y - chair.y);
    expect(dist).toBeGreaterThan(CHAIR_HW); // outside the chair
    expect(dist).toBeLessThan(CHAIR_HW + 1.5); // not far away
  });
});

describe('zoneCentroidOfOthers', () => {
  it('returns null when no other NPCs share the zone', () => {
    expect(zoneCentroidOfOthers('table_a', [], 'self')).toBeNull();
    expect(
      zoneCentroidOfOthers(
        'table_a',
        [npc({ id: 'self', zone: 'table_a' })],
        'self',
      ),
    ).toBeNull();
  });

  it('averages positions of other NPCs in the same zone', () => {
    const result = zoneCentroidOfOthers(
      'table_a',
      [
        npc({ id: 'a', zone: 'table_a', position: { x: 28, y: 58 } }),
        npc({ id: 'b', zone: 'table_a', position: { x: 32, y: 62 } }),
        npc({ id: 'elsewhere', zone: 'bar', position: { x: 50, y: 20 } }),
        npc({ id: 'self', zone: 'table_a', position: { x: 100, y: 100 } }),
      ],
      'self',
    );
    expect(result?.x).toBeCloseTo(30);
    expect(result?.y).toBeCloseTo(60);
  });
});

// Integration: pickPositionInZone wires chairs + centroid + jitter together.
describe('pickPositionInZone', () => {
  it('snaps to a free chair when one is in the zone', () => {
    const chair = piece({ id: 'c1', sprite: 'chair_01', x: 28, y: 60 });
    const rng = seededRng('integ', 'a');
    const p = pickPositionInZone('table_a', rng, {
      absSubTick: 1,
      worldSeed: 'integ',
      subTicksPerDay: 60,
      furniture: [chair],
      roster: [],
      selfId: 'self',
    });
    const dist = Math.hypot(p.x - chair.x, p.y - chair.y);
    // positioned just outside the chair sprite.
    expect(dist).toBeGreaterThan(CHAIR_HW);
    expect(dist).toBeLessThan(CHAIR_HW + 1.5);
  });

  it('clusters toward the centroid of co-occupants when no chairs are placed', () => {
    // Two NPCs hugging the right edge of table_a. With CLUSTER_BIAS_PROB=0.6
    // most seeds bias the picked position toward their average; we sample
    // enough to make the mean tendency observable.
    const others = [
      npc({ id: 'a', zone: 'table_a', position: { x: 34, y: 62 } }),
      npc({ id: 'b', zone: 'table_a', position: { x: 35, y: 63 } }),
    ];
    let near = 0;
    for (let i = 0; i < 80; i += 1) {
      const rng = seededRng('integ', 'cluster', `${i}`);
      const p = pickPositionInZone('table_a', rng, {
        absSubTick: i,
        worldSeed: 'integ',
        subTicksPerDay: 60,
        furniture: [],
        roster: others,
        selfId: 'self',
      });
      if (p.x > 30 && p.y > 60) near += 1;
    }
    // Without clustering the right-side share would be ~25%; with the 60%
    // bias it should comfortably exceed 50.
    expect(near).toBeGreaterThan(40);
  });

  it('falls back to jitterInsideZone when furniture and roster are empty', () => {
    const rng = seededRng('integ', 'fallback');
    const p = pickPositionInZone('table_b', rng, {
      absSubTick: 1,
      worldSeed: 'integ',
      subTicksPerDay: 60,
    });
    // table_b center (50, 65), radius 7.
    expect(Math.hypot(p.x - 50, p.y - 65)).toBeLessThanOrEqual(7);
  });
});
