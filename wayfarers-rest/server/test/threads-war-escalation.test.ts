import { describe, expect, it } from 'vitest';
import type { Thread, WorldState } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import '../src/threads/archetypes/index.ts'; // registers production archetypes
import { ThreadRunner } from '../src/threads/runner.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldTagsManager } from '../src/world/tags.ts';
import { seedPhase3World } from '../src/world/world-init.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function fakeWorld(gameDay: number): WorldState {
  return {
    gameDay,
    lastTickAt: new Date(NOW).toISOString(),
    status: 'running',
    unattendedTicks: 0,
    seed: 'war-seed',
    subTick: 0,
    lastAcknowledgedGameDay: 0,
    favors: 3,
    favorsLastRegenGameDay: 0,
    markedNpcIds: [],
    coin: 0,
    prosperity: 0,
  };
}

function build() {
  const p = new Persistence(':memory:');
  const bus = new WorldEventBus(p, new FakeClock(NOW));
  const tags = new WorldTagsManager(p, bus);
  const runner = new ThreadRunner(p, bus, tags, new RumorsManager(p, bus));
  return { p, runner, tags };
}

function runThrough(runner: ThreadRunner, lastDay: number) {
  for (let d = 2; d <= lastDay; d += 1) {
    runner.runDay(d, fakeWorld(d), 'war-seed');
  }
}

describe('war_escalation archetype', () => {
  it('escalates the world tags step by step, then resolves', () => {
    const { p, runner } = build();
    const thread = runner.startThread({
      type: 'war_escalation',
      initialNextTickDelay: 4,
      gameDay: 1,
    });
    runThrough(runner, 24);

    const final = p.loadAllThreads().find((t) => t.id === thread.id) as Thread;
    expect(final.status).toBe('completed');
    expect(['ended', 'stalemate']).toContain(final.state);

    const states = final.history.map((h) => h.state);
    expect(states).toContain('escalating');
    expect(states).toContain('crisis');
    expect(states).toContain('resolving');

    // The roads recover; the war ends resolved or simmered down.
    expect(p.getWorldTag('road_safety_south')?.value).toBe('fair');
    expect(['resolved', 'simmering']).toContain(p.getWorldTag('war_in_north')?.value);

    expect(p.loadAllRumors().some((r) => r.text.includes('war in the north'))).toBe(
      true,
    );
  });

  it('same seed produces identical history', () => {
    const a = build();
    a.runner.startThread({ type: 'war_escalation', initialNextTickDelay: 4, gameDay: 1 });
    runThrough(a.runner, 24);

    const b = build();
    b.runner.startThread({ type: 'war_escalation', initialNextTickDelay: 4, gameDay: 1 });
    runThrough(b.runner, 24);

    const aThread = a.p
      .loadAllThreads()
      .find((t) => t.type === 'war_escalation') as Thread;
    const bThread = b.p
      .loadAllThreads()
      .find((t) => t.type === 'war_escalation') as Thread;
    expect(aThread.history).toEqual(bThread.history);
  });

  it('seedPhase3World seeds a war_escalation thread for war_in_north', () => {
    const { p, runner, tags } = build();
    seedPhase3World({
      worldSeed: 'w',
      gameDay: 1,
      worldTags: tags,
      threadRunner: runner,
    });

    expect(p.loadAllThreads().some((t) => t.type === 'war_escalation')).toBe(true);
    // war_in_north is no longer driven by a plain worldly_event sequence.
    const worldlyWar = p
      .loadAllThreads()
      .filter((t) => t.type === 'worldly_event')
      .some((t) => (t.payload as { tagKey?: string }).tagKey === 'war_in_north');
    expect(worldlyWar).toBe(false);
  });
});
