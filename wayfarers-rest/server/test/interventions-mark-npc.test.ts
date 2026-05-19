import { describe, expect, it } from 'vitest';
import type { Npc } from '@shared/types';
import { score } from '../src/chronicle/salience.ts';
import { DEFAULT_ALARMING_VALUES } from '../src/chronicle/types.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { buildMarkNpc } from '../src/interventions/kinds/mark-npc.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function build() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const stateManager = new WorldStateManager(persistence, clock, () => 'mark-seed');
  const bus = new WorldEventBus(persistence, clock);
  const npcManager = new NpcManager(
    { worldSeed: 'mark-seed', subTicksPerDay: 30 },
    { persistence, bus },
  );
  const mark = buildMarkNpc({ npcManager, stateManager, bus });
  const npc: Npc = {
    id: 'npc_x',
    displayName: 'Mara Thistlewick',
    status: 'at_bar',
    position: { x: 50, y: 50 },
    zone: 'bar',
    arrivedGameDay: 1,
    arrivedSubTick: 0,
    plannedDepartureGameDay: 5,
    plannedDepartureSubTick: 0,
    nextDecisionSubTick: 99,
    carriedRumorIds: [],
  };
  npcManager.hydrate({ npcs: [npc], spawnQueue: [] });
  return { persistence, stateManager, bus, npcManager, mark, npc };
}

describe('mark_npc intervention', () => {
  it('apply adds id to markedNpcIds and emits npc_marked', () => {
    const h = build();
    const effect = h.mark.apply({
      payload: { npcId: 'npc_x' },
      helpers: {} as never,
      state: h.stateManager.getState(),
      options: { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    expect(effect.markedNpcId).toBe('npc_x');
    expect(h.stateManager.getState().markedNpcIds).toContain('npc_x');
    expect(
      h.persistence.getEventsSince(0).some((e) => e.event.type === 'npc_marked'),
    ).toBe(true);
  });

  it('subsequent interaction events involving the marked NPC score +5', () => {
    const h = build();
    h.mark.apply({
      payload: { npcId: 'npc_x' },
      helpers: {} as never,
      state: h.stateManager.getState(),
      options: { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    const ctxNoMark = {
      npcsById: new Map([['npc_x', h.npc]]),
      threadsById: new Map(),
      alarmingValues: DEFAULT_ALARMING_VALUES,
    };
    const ctxWithMark = {
      ...ctxNoMark,
      markedNpcIds: new Set(['npc_x']),
    };
    const event = {
      type: 'interaction' as const,
      gameDay: 1,
      interaction: {
        id: 'int_x',
        gameDay: 1,
        subTick: 5,
        zone: 'bar' as const,
        participantIds: ['npc_x', 'npc_y'],
        kind: 'shared_drink' as const,
      },
    };
    expect(score(event, ctxWithMark) - score(event, ctxNoMark)).toBe(5);
  });

  it('validate rejects already-marked NPCs', () => {
    const h = build();
    h.mark.apply({
      payload: { npcId: 'npc_x' },
      helpers: {} as never,
      state: h.stateManager.getState(),
      options: { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
      gameDay: 1,
    });
    const r = h.mark.validate(
      { npcId: 'npc_x' },
      h.stateManager.getState(),
      { state: h.stateManager.getState(), targets: {} as never, availableRumors: [] },
    );
    expect(r.ok).toBe(false);
  });
});
