import { describe, expect, it } from 'vitest';
import type { Npc, TavernConfig, WorldState } from '@shared/types';
import { initialState, reducer } from '../src/state/reducer.ts';

const NPC_A: Npc = {
  id: 'npc_d1_0',
  displayName: 'Mara',
  status: 'arriving',
  position: { x: 50, y: 95 },
  zone: 'door',
  arrivedGameDay: 1,
  arrivedSubTick: 10,
  plannedDepartureGameDay: 1,
  plannedDepartureSubTick: 200,
  nextDecisionSubTick: 11,
};

const NPC_B: Npc = { ...NPC_A, id: 'npc_d1_1', displayName: 'Brennan' };

const TAVERN: TavernConfig = {
  zones: [{ name: 'door', x: 50, y: 95, radius: 6 }],
  subTickIntervalMs: 10_000,
  subTicksPerDay: 360,
};

const WORLD: WorldState = {
  gameDay: 1,
  lastTickAt: '2026-01-01T00:00:00.000Z',
  status: 'running',
  unattendedTicks: 0,
  seed: 'seed',
  subTick: 0,
};

describe('reducer', () => {
  it('INIT_TAVERN stores tavern config', () => {
    const next = reducer(initialState, { type: 'INIT_TAVERN', payload: TAVERN });
    expect(next.tavern).toEqual(TAVERN);
  });

  it('INIT_STATE and STATE_UPDATE store world state', () => {
    const a = reducer(initialState, { type: 'INIT_STATE', payload: WORLD });
    expect(a.world).toEqual(WORLD);
    const updated: WorldState = { ...WORLD, gameDay: 2, subTick: 5 };
    const b = reducer(a, { type: 'STATE_UPDATE', payload: updated });
    expect(b.world).toEqual(updated);
  });

  it('NPCS_SNAPSHOT replaces the roster wholesale', () => {
    const populated = reducer(initialState, {
      type: 'NPCS_SNAPSHOT',
      payload: [NPC_A, NPC_B],
    });
    expect(Object.keys(populated.npcs).sort()).toEqual(['npc_d1_0', 'npc_d1_1']);
    const replaced = reducer(populated, {
      type: 'NPCS_SNAPSHOT',
      payload: [NPC_B],
    });
    expect(Object.keys(replaced.npcs)).toEqual(['npc_d1_1']);
  });

  it('NPCS_DIFF applies adds/updates/removes', () => {
    const populated = reducer(initialState, {
      type: 'NPCS_SNAPSHOT',
      payload: [NPC_A],
    });
    const after = reducer(populated, {
      type: 'NPCS_DIFF',
      payload: {
        added: [NPC_B],
        updated: [{ ...NPC_A, status: 'at_bar' }],
        removed: [],
      },
    });
    expect(after.npcs['npc_d1_0'].status).toBe('at_bar');
    expect(after.npcs['npc_d1_1'].displayName).toBe('Brennan');
  });

  it('NPCS_DIFF removing a missing id is a graceful no-op', () => {
    const populated = reducer(initialState, {
      type: 'NPCS_SNAPSHOT',
      payload: [NPC_A],
    });
    const after = reducer(populated, {
      type: 'NPCS_DIFF',
      payload: { added: [], updated: [], removed: ['npc_d1_unknown'] },
    });
    expect(after.npcs).toEqual(populated.npcs);
  });

  it('NPCS_DIFF removed entry drops it from the roster', () => {
    const populated = reducer(initialState, {
      type: 'NPCS_SNAPSHOT',
      payload: [NPC_A, NPC_B],
    });
    const after = reducer(populated, {
      type: 'NPCS_DIFF',
      payload: { added: [], updated: [], removed: ['npc_d1_0'] },
    });
    expect(Object.keys(after.npcs)).toEqual(['npc_d1_1']);
  });

  it('preserves unrelated slices across each action', () => {
    let s = reducer(initialState, { type: 'INIT_TAVERN', payload: TAVERN });
    s = reducer(s, { type: 'INIT_STATE', payload: WORLD });
    s = reducer(s, { type: 'NPCS_SNAPSHOT', payload: [NPC_A] });
    expect(s.tavern).toEqual(TAVERN);
    expect(s.world).toEqual(WORLD);
    expect(s.npcs['npc_d1_0']).toEqual(NPC_A);
  });
});
