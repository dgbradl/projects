import { describe, expect, it } from 'vitest';
import type { Thread, WorldState } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import '../src/threads/archetypes/index.ts'; // registers production archetypes
import { ThreadRunner } from '../src/threads/runner.ts';
import { RumorsManager } from '../src/world/rumors.ts';
import { WorldTagsManager } from '../src/world/tags.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function fakeWorld(gameDay: number): WorldState {
  return {
    gameDay,
    lastTickAt: new Date(NOW).toISOString(),
    status: 'running',
    unattendedTicks: 0,
    seed: 'feud-seed',
    subTick: 0,
    lastAcknowledgedGameDay: 0,
    favors: 3,
    favorsLastRegenGameDay: 0,
    markedNpcIds: [],
    coin: 0,
  };
}

function build() {
  const p = new Persistence(':memory:');
  const bus = new WorldEventBus(p, new FakeClock(NOW));
  const runner = new ThreadRunner(
    p,
    bus,
    new WorldTagsManager(p, bus),
    new RumorsManager(p, bus),
  );
  return { p, runner };
}

function runThrough(runner: ThreadRunner, lastDay: number, seed = 'feud-seed') {
  for (let d = 2; d <= lastDay; d += 1) {
    runner.runDay(d, fakeWorld(d), seed);
  }
}

describe('feud archetype', () => {
  it('escalates through its stages, sets the world tag, and spreads rumours', () => {
    const { p, runner } = build();
    const thread = runner.startThread({
      type: 'feud',
      payload: { sideA: 'Borin', sideB: 'Sera', tagKey: 'feud_borin_sera' },
      gameDay: 1,
    });
    runThrough(runner, 20);

    const final = p.loadAllThreads().find((t) => t.id === thread.id) as Thread;
    expect(final.status).toBe('completed');
    expect(['reconciled', 'entrenched']).toContain(final.state);

    // The feud passed through both escalation beats.
    const states = final.history.map((h) => h.state);
    expect(states).toContain('factions');
    expect(states).toContain('head');

    // Its world tag reflects the outcome.
    expect(['eased', 'bitter']).toContain(p.getWorldTag('feud_borin_sera')?.value);

    // Each beat spread a rumour naming the parties.
    const rumors = p.loadAllRumors();
    expect(rumors.length).toBeGreaterThan(0);
    expect(rumors.some((r) => r.text.includes('Borin') && r.text.includes('Sera'))).toBe(
      true,
    );
  });

  it('same seed produces identical history', () => {
    const a = build();
    a.runner.startThread({
      type: 'feud',
      payload: { sideA: 'Borin', sideB: 'Sera', tagKey: 'feud_x' },
      gameDay: 1,
    });
    runThrough(a.runner, 20);

    const b = build();
    b.runner.startThread({
      type: 'feud',
      payload: { sideA: 'Borin', sideB: 'Sera', tagKey: 'feud_x' },
      gameDay: 1,
    });
    runThrough(b.runner, 20);

    const aThread = a.p.loadAllThreads().find((t) => t.type === 'feud') as Thread;
    const bThread = b.p.loadAllThreads().find((t) => t.type === 'feud') as Thread;
    expect(aThread.history).toEqual(bThread.history);
  });

  it('a hardened relationship feud escalates into a feud thread', () => {
    const { p, runner } = build();
    runner.startThread({
      type: 'relationship',
      payload: {
        aId: 'a',
        bId: 'b',
        aName: 'Borin',
        bName: 'Sera',
        kind: 'feud',
      },
      gameDay: 1,
    });
    runThrough(runner, 12);

    const feud = p.loadAllThreads().find((t) => t.type === 'feud') as
      | Thread
      | undefined;
    expect(feud).toBeDefined();
    expect(feud!.payload).toMatchObject({
      sideA: 'Borin',
      sideB: 'Sera',
      tagKey: 'feud_a_b',
    });
  });

  it('a friendship does not spawn a feud thread', () => {
    const { p, runner } = build();
    runner.startThread({
      type: 'relationship',
      payload: {
        aId: 'a',
        bId: 'b',
        aName: 'Borin',
        bName: 'Sera',
        kind: 'friendship',
      },
      gameDay: 1,
    });
    runThrough(runner, 12);

    expect(p.loadAllThreads().some((t) => t.type === 'feud')).toBe(false);
  });
});
