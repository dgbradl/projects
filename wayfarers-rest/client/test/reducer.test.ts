import { describe, expect, it } from 'vitest';
import type {
  EventLogEntry,
  Npc,
  Rumor,
  ScheduledArrival,
  TavernConfig,
  Thread,
  WorldSnapshot,
  WorldState,
  WorldTag,
} from '@shared/types';
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
  carriedRumorIds: [],
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
  lastAcknowledgedGameDay: 0,
  favors: 3,
  favorsLastRegenGameDay: 0,
  markedNpcIds: [],
  coin: 200,
  prosperity: 50,
};

const TAG: WorldTag = { key: 'season', value: 'spring', setOnGameDay: 1 };
const THREAD: Thread = {
  id: 'thread_d1_worldly_event_0',
  type: 'worldly_event',
  status: 'active',
  state: 'cued',
  startedGameDay: 1,
  nextTickGameDay: 4,
  payload: {},
  history: [],
};
const ARRIVAL: ScheduledArrival = {
  npcId: 'thread_npc_x',
  displayName: 'Y',
  scheduledGameDay: 4,
  scheduledSubTick: 0,
};
const RUMOR: Rumor = {
  id: 'rumor_d1_0',
  text: 'x',
  introducedGameDay: 1,
  available: true,
};

const WORLD_SNAPSHOT: WorldSnapshot = {
  worldTags: [TAG],
  threads: [THREAD],
  pendingArrivals: [ARRIVAL],
  rumors: [RUMOR],
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

  it('WORLD_SNAPSHOT replaces tags / threads / arrivals / rumors wholesale', () => {
    const next = reducer(initialState, {
      type: 'WORLD_SNAPSHOT',
      payload: WORLD_SNAPSHOT,
    });
    expect(next.worldTags).toEqual([TAG]);
    expect(next.threads).toEqual([THREAD]);
    expect(next.pendingArrivals).toEqual([ARRIVAL]);
    expect(next.rumors).toEqual([RUMOR]);

    const cleared = reducer(next, {
      type: 'WORLD_SNAPSHOT',
      payload: { worldTags: [], threads: [], pendingArrivals: [], rumors: [] },
    });
    expect(cleared.worldTags).toEqual([]);
    expect(cleared.threads).toEqual([]);
  });

  it('WORLD_EVENT pushes entries onto the bounded recent-events buffer', () => {
    const entry: EventLogEntry = {
      id: 1,
      realTimestamp: 't',
      event: { type: 'init', gameDay: 1 },
    };
    const a = reducer(initialState, { type: 'WORLD_EVENT', payload: entry });
    expect(a.recentEvents).toHaveLength(1);
    const b = reducer(a, {
      type: 'WORLD_EVENT',
      payload: { ...entry, id: 2 },
    });
    expect(b.recentEvents[0].id).toBe(2);
    expect(b.recentEvents[1].id).toBe(1);
  });

  it('INTERACTION_FLASH adds expiries; EXPIRE_INTERACTION_FLASHES drops expired', () => {
    const now = 1_000_000;
    const a = reducer(initialState, {
      type: 'INTERACTION_FLASH',
      payload: { npcIds: ['x', 'y'], expiresAt: now + 1000 },
    });
    expect(Object.keys(a.interactingNpcs).sort()).toEqual(['x', 'y']);
    const b = reducer(a, {
      type: 'EXPIRE_INTERACTION_FLASHES',
      payload: { now: now + 2000 },
    });
    expect(b.interactingNpcs).toEqual({});
  });
});
