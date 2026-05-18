import { describe, expect, it } from 'vitest';
import type { NpcStatus } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { SubTickScheduler } from '../src/subtick.ts';
import { TickScheduler } from '../src/tick.ts';

const SUB_TICKS_PER_DAY = 60;
const SUBTICK_MS = 100;
const TICK_INTERVAL = SUBTICK_MS * SUB_TICKS_PER_DAY;
const START = Date.parse('2026-01-01T00:00:00.000Z');

function buildHarness() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(START);
  const stateManager = new WorldStateManager(
    persistence,
    clock,
    () => 'behavior-seed',
  );
  const bus = new WorldEventBus(persistence, clock);
  const npcManager = new NpcManager(
    { worldSeed: stateManager.getState().seed, subTicksPerDay: SUB_TICKS_PER_DAY },
    { persistence, bus },
  );
  npcManager.onMacroTick(stateManager.getState().gameDay);
  const tickScheduler = new TickScheduler(
    stateManager,
    clock,
    { tickIntervalMs: TICK_INTERVAL, schedulerCheckMs: 50 },
    bus,
  );
  const subTickScheduler = new SubTickScheduler(
    stateManager,
    npcManager,
    clock,
    { subTickIntervalMs: SUBTICK_MS, subTicksPerDay: SUB_TICKS_PER_DAY },
  );
  return {
    persistence,
    clock,
    stateManager,
    npcManager,
    tickScheduler,
    subTickScheduler,
    bus,
  };
}

describe('NPC behavior over a full game day', () => {
  it('a sampled NPC progresses through plausible states and ends departed', () => {
    const h = buildHarness();
    const queue = h.npcManager.getSpawnQueue();
    expect(queue.length).toBeGreaterThan(0);
    const subject = queue[0];

    const observedStatuses = new Set<NpcStatus>();
    let lastSeen = null as ReturnType<typeof h.npcManager.getRoster>[number] | null;

    // Run the day to completion plus a margin (so leavers actually leave).
    const totalSubTicksToSimulate = SUB_TICKS_PER_DAY + 220;
    for (let i = 0; i < totalSubTicksToSimulate; i += 1) {
      h.subTickScheduler.advance(SUBTICK_MS);
      // After the day rolls over, advance the macro tick.
      if ((i + 1) % SUB_TICKS_PER_DAY === 0) {
        h.tickScheduler.advance(0); // no extra time; macro already advanced via sub-tick wall clock
      }
      const roster = h.npcManager.getRoster();
      const npc = roster.find((n) => n.id === subject.npcId);
      if (npc) {
        observedStatuses.add(npc.status);
        lastSeen = npc;
      }
    }

    // Subject was actually instantiated at some point.
    expect(lastSeen).not.toBeNull();

    // Pass through at least one social state.
    const socialStates: NpcStatus[] = ['at_bar', 'seated', 'wandering'];
    const sawSocial = socialStates.some((s) => observedStatuses.has(s));
    expect(sawSocial).toBe(true);

    // Final state: removed from roster (departed) — i.e. not currently in the
    // roster snapshot at the end of the simulation.
    const finalRoster = h.npcManager.getRoster();
    expect(finalRoster.find((n) => n.id === subject.npcId)).toBeUndefined();

    // The subject's last-observed plannedDeparture must have been at or before
    // the time at which it left (we only see the last state before removal).
    const lastDepAbs =
      lastSeen!.plannedDepartureGameDay * SUB_TICKS_PER_DAY +
      lastSeen!.plannedDepartureSubTick;
    expect(lastDepAbs).toBeGreaterThanOrEqual(
      lastSeen!.arrivedGameDay * SUB_TICKS_PER_DAY + lastSeen!.arrivedSubTick,
    );
  });

  it('npcs are positioned inside the tavern bounds at every observed sub-tick', () => {
    const h = buildHarness();
    for (let i = 0; i < SUB_TICKS_PER_DAY * 2; i += 1) {
      h.subTickScheduler.advance(SUBTICK_MS);
      for (const npc of h.npcManager.getRoster()) {
        expect(npc.position.x).toBeGreaterThanOrEqual(0);
        expect(npc.position.x).toBeLessThanOrEqual(100);
        expect(npc.position.y).toBeGreaterThanOrEqual(0);
        expect(npc.position.y).toBeLessThanOrEqual(100);
      }
    }
  });
});
