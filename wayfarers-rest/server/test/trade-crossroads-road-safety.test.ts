/**
 * Phase 9 (G3): trade_crossroads bumps road-safety recovery.
 *
 * The war_escalation thread settles road_safety_south at 'fair' when it
 * reaches `resolving`. With the `trade_crossroads` tavern trait active,
 * recovery should jump straight to 'good' (the road attracts patrols).
 */
import { describe, expect, it } from 'vitest';
import type { TavernTrait, WorldState } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import '../src/threads/archetypes/index.ts';
import { ThreadRunner } from '../src/threads/runner.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldTagsManager } from '../src/world/tags.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function fakeWorld(gameDay: number, tavernTraits: TavernTrait[] = []): WorldState {
  return {
    gameDay,
    lastTickAt: new Date(NOW).toISOString(),
    status: 'running',
    unattendedTicks: 0,
    seed: 'crossroads-seed',
    subTick: 0,
    lastAcknowledgedGameDay: 0,
    favors: 3,
    favorsLastRegenGameDay: 0,
    markedNpcIds: [],
    coin: 0,
    prosperity: 50,
    tavernName: "The Wayfarer's Rest",
    tavernTraits,
  };
}

function build() {
  const p = new Persistence(':memory:');
  const bus = new WorldEventBus(p, new FakeClock(NOW));
  const tags = new WorldTagsManager(p, bus);
  const runner = new ThreadRunner(p, bus, tags, new RumorsManager(p, bus));
  return { p, runner };
}

function runThrough(
  runner: ThreadRunner,
  lastDay: number,
  traits: TavernTrait[],
) {
  for (let d = 2; d <= lastDay; d += 1) {
    runner.runDay(d, fakeWorld(d, traits), 'crossroads-seed');
  }
}

describe('G3 — trade_crossroads → road_safety_south recovery', () => {
  it('without trade_crossroads, recovery settles at "fair"', () => {
    const { p, runner } = build();
    runner.startThread({
      type: 'war_escalation',
      initialNextTickDelay: 4,
      gameDay: 1,
    });
    runThrough(runner, 24, []);
    expect(p.getWorldTag('road_safety_south')?.value).toBe('fair');
  });

  it('with trade_crossroads, recovery jumps to "good"', () => {
    const { p, runner } = build();
    runner.startThread({
      type: 'war_escalation',
      initialNextTickDelay: 4,
      gameDay: 1,
    });
    runThrough(runner, 24, ['trade_crossroads']);
    expect(p.getWorldTag('road_safety_south')?.value).toBe('good');
  });

  it("trade_crossroads stacked with another trait still bumps road safety", () => {
    const { p, runner } = build();
    runner.startThread({
      type: 'war_escalation',
      initialNextTickDelay: 4,
      gameDay: 1,
    });
    runThrough(runner, 24, ['trade_crossroads', 'bardic_stage']);
    expect(p.getWorldTag('road_safety_south')?.value).toBe('good');
  });

  it("an unrelated trait does NOT bump road safety", () => {
    const { p, runner } = build();
    runner.startThread({
      type: 'war_escalation',
      initialNextTickDelay: 4,
      gameDay: 1,
    });
    runThrough(runner, 24, ['scholars_quiet']);
    expect(p.getWorldTag('road_safety_south')?.value).toBe('fair');
  });
});
