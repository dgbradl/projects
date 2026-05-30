/**
 * Phase 9 (F3): wedding / court_day / storyteller_circle scenario tests.
 *
 * Each scenario has its own trigger path:
 *   - wedding         → npc_arrived (pilgrim) + matching tavernTrait + crowd
 *   - court_day       → npc_arrived (knight)
 *   - storyteller     → onSubTick scan: bard at hearth + 3+ audience
 *
 * Tests pin the gates (required archetype, required trait, required
 * crowd) and verify the resolved outcome is 'completed' (not
 * 'burned_out') for non-conflict scenes.
 */
import { describe, expect, it } from 'vitest';
import type {
  EventLogEntry,
  Npc,
  TavernTrait,
  WorldEvent,
  ZoneName,
} from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { StageRunner } from '../src/stage/runner.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');
const SUBTICKS_PER_DAY = 360;

function npc(input: {
  id: string;
  archetype: string;
  zone?: ZoneName;
  isStaff?: boolean;
  status?: Npc['status'];
}): Npc {
  return {
    id: input.id,
    displayName: input.id,
    status: input.status ?? 'at_bar',
    position: { x: 50, y: 50 },
    zone: input.zone ?? 'bar',
    arrivedGameDay: 1,
    arrivedSubTick: 10,
    plannedDepartureGameDay: 9,
    plannedDepartureSubTick: 0,
    nextDecisionSubTick: 0,
    carriedRumorIds: [],
    archetype: input.archetype,
    visitCount: 1,
    isStaff: input.isStaff,
  };
}

function setup(opts: {
  tavernTraits?: TavernTrait[];
  roster?: Npc[];
  rngHit?: boolean;
}) {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const stateManager = new WorldStateManager(persistence, clock, () => 'f3-seed');
  if (opts.tavernTraits) {
    stateManager.setState({
      ...stateManager.getState(),
      tavernTraits: opts.tavernTraits,
    });
  }
  const bus = new WorldEventBus(persistence, clock);
  const scenarioRng = opts.rngHit !== undefined
    ? () => (opts.rngHit ? 0 : 0.99)
    : undefined;
  const runner = new StageRunner({
    persistence,
    bus,
    worldSeed: 'f3-seed',
    subTicksPerDay: SUBTICKS_PER_DAY,
    stateManager,
    getRoster: () => opts.roster ?? [],
    scenarioRng,
  });
  runner.attach();
  const events: WorldEvent[] = [];
  bus.on('world_event', (entry: EventLogEntry) => events.push(entry.event));
  return { persistence, bus, runner, events };
}

// ---------- wedding ----------

describe('wedding scenario', () => {
  function fillRoster(pilgrimId: string): Npc[] {
    const pilgrim = npc({ id: pilgrimId, archetype: 'pilgrim', zone: 'door', status: 'arriving' });
    // 4 other non-staff bodies — that's the minimum.
    const others = [
      npc({ id: 'g1', archetype: 'wanderer', zone: 'bar' }),
      npc({ id: 'g2', archetype: 'merchant', zone: 'bar' }),
      npc({ id: 'g3', archetype: 'scholar', zone: 'table_a' }),
      npc({ id: 'g4', archetype: 'soldier', zone: 'bar' }),
    ];
    return [pilgrim, ...others];
  }

  it('fires on pilgrim arrival when trait + crowd + roll all align', () => {
    const roster = fillRoster('p1');
    const h = setup({
      tavernTraits: ['pilgrims_pause'],
      roster,
      rngHit: true,
    });
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 2,
      npcId: 'p1',
      displayName: 'p1',
    });
    const live = h.runner.getLiveScenes();
    expect(live).toHaveLength(1);
    expect(live[0].type).toBe('wedding');
    expect(live[0].zone).toBe('hearth');
    expect(live[0].participantNpcIds).toEqual(['p1']);
    h.persistence.close();
  });

  it('does NOT fire without a matching trait', () => {
    const roster = fillRoster('p1');
    const h = setup({
      tavernTraits: ['martial_billet'], // no match
      roster,
      rngHit: true,
    });
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 2,
      npcId: 'p1',
      displayName: 'p1',
    });
    expect(h.runner.getLiveScenes()).toHaveLength(0);
    h.persistence.close();
  });

  it('does NOT fire when the crowd is too small', () => {
    const small = [
      npc({ id: 'p1', archetype: 'pilgrim', zone: 'door', status: 'arriving' }),
      npc({ id: 'g1', archetype: 'wanderer', zone: 'bar' }), // only 1 other
    ];
    const h = setup({
      tavernTraits: ['pilgrims_pause'],
      roster: small,
      rngHit: true,
    });
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 2,
      npcId: 'p1',
      displayName: 'p1',
    });
    expect(h.runner.getLiveScenes()).toHaveLength(0);
    h.persistence.close();
  });

  it('does NOT fire for non-pilgrim arrivals even with the trait + crowd', () => {
    const roster = fillRoster('p1');
    // Replace the pilgrim with a wanderer.
    roster[0] = npc({ id: 'p1', archetype: 'wanderer', zone: 'door' });
    const h = setup({
      tavernTraits: ['pilgrims_pause'],
      roster,
      rngHit: true,
    });
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 2,
      npcId: 'p1',
      displayName: 'p1',
    });
    expect(h.runner.getLiveScenes()).toHaveLength(0);
    h.persistence.close();
  });

  it('also accepts hearthside_refuge as a matching trait', () => {
    const roster = fillRoster('p1');
    const h = setup({
      tavernTraits: ['hearthside_refuge'],
      roster,
      rngHit: true,
    });
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 2,
      npcId: 'p1',
      displayName: 'p1',
    });
    expect(h.runner.getLiveScenes()).toHaveLength(1);
    h.persistence.close();
  });

  it('resolves with outcome=completed (not burned_out)', () => {
    const roster = fillRoster('p1');
    const h = setup({
      tavernTraits: ['pilgrims_pause'],
      roster,
      rngHit: true,
    });
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 2,
      npcId: 'p1',
      displayName: 'p1',
    });
    // Wedding timing totals 20 sub-ticks; run plenty.
    for (let st = 10; st < 60; st += 1) {
      h.runner.onSubTick(2, st, roster);
    }
    const resolved = h.events.find((e) => e.type === 'stage_event_resolved') as
      | (WorldEvent & { type: 'stage_event_resolved' })
      | undefined;
    expect(resolved).toBeDefined();
    expect(resolved!.outcome).toBe('completed');
    h.persistence.close();
  });
});

// ---------- court_day ----------

describe('court_day scenario', () => {
  it('fires on knight arrival when the roll hits', () => {
    const roster = [
      npc({ id: 'k1', archetype: 'knight', zone: 'door', status: 'arriving' }),
      npc({ id: 'g1', archetype: 'wanderer', zone: 'bar' }),
    ];
    const h = setup({ roster, rngHit: true });
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 1,
      npcId: 'k1',
      displayName: 'k1',
    });
    const live = h.runner.getLiveScenes();
    expect(live).toHaveLength(1);
    expect(live[0].type).toBe('court_day');
    expect(live[0].zone).toBe('table_b');
    h.persistence.close();
  });

  it('ignores non-knight arrivals', () => {
    const roster = [
      npc({ id: 's1', archetype: 'soldier', zone: 'door', status: 'arriving' }),
    ];
    const h = setup({ roster, rngHit: true });
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 1,
      npcId: 's1',
      displayName: 's1',
    });
    expect(h.runner.getLiveScenes()).toHaveLength(0);
    h.persistence.close();
  });

  it('respects the per-day cap (1 court_day/day)', () => {
    const roster = [
      npc({ id: 'k1', archetype: 'knight', zone: 'door' }),
      npc({ id: 'k2', archetype: 'knight', zone: 'door' }),
    ];
    const h = setup({ roster, rngHit: true });
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 1,
      npcId: 'k1',
      displayName: 'k1',
    });
    // Resolve the first court day so the in-flight gate releases.
    for (let st = 10; st < 60; st += 1) {
      h.runner.onSubTick(1, st, roster);
    }
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 1,
      npcId: 'k2',
      displayName: 'k2',
    });
    // Should refuse — cap of 1 reached.
    expect(h.runner.getLiveScenes()).toHaveLength(0);
    h.persistence.close();
  });
});

// ---------- storyteller_circle ----------

describe('storyteller_circle scenario', () => {
  function withBardAtHearth(audienceCount: number): Npc[] {
    const r: Npc[] = [
      npc({ id: 'bard1', archetype: 'bard', zone: 'hearth' }),
    ];
    for (let i = 0; i < audienceCount; i += 1) {
      r.push(
        npc({ id: `a${i}`, archetype: 'wanderer', zone: 'hearth' }),
      );
    }
    return r;
  }

  it('fires when a bard is at the hearth with 3+ NPCs gathered', () => {
    const roster = withBardAtHearth(3);
    const h = setup({ roster, rngHit: true });
    h.runner.onSubTick(1, 50, roster);
    const live = h.runner.getLiveScenes();
    expect(live).toHaveLength(1);
    expect(live[0].type).toBe('storyteller_circle');
    expect(live[0].zone).toBe('hearth');
    h.persistence.close();
  });

  it('does NOT fire with a thin audience (< 3)', () => {
    const roster = withBardAtHearth(2);
    const h = setup({ roster, rngHit: true });
    for (let st = 0; st < 100; st += 1) {
      h.runner.onSubTick(1, st, roster);
    }
    expect(h.runner.getLiveScenes()).toHaveLength(0);
    h.persistence.close();
  });

  it('does NOT fire without a bard at the hearth (bard elsewhere)', () => {
    const roster: Npc[] = [
      npc({ id: 'bard1', archetype: 'bard', zone: 'bar' }), // wrong zone
      npc({ id: 'a1', archetype: 'wanderer', zone: 'hearth' }),
      npc({ id: 'a2', archetype: 'wanderer', zone: 'hearth' }),
      npc({ id: 'a3', archetype: 'wanderer', zone: 'hearth' }),
    ];
    const h = setup({ roster, rngHit: true });
    for (let st = 0; st < 100; st += 1) {
      h.runner.onSubTick(1, st, roster);
    }
    expect(h.runner.getLiveScenes()).toHaveLength(0);
    h.persistence.close();
  });

  it('seats up to 4 audience members alongside the bard', () => {
    const roster = withBardAtHearth(8); // many in audience
    const h = setup({ roster, rngHit: true });
    h.runner.onSubTick(1, 50, roster);
    const live = h.runner.getLiveScenes();
    expect(live).toHaveLength(1);
    // 1 bard + up to 4 audience = up to 5.
    expect(live[0].participantNpcIds.length).toBeLessThanOrEqual(5);
    expect(live[0].participantNpcIds[0]).toBe('bard1');
    h.persistence.close();
  });
});
