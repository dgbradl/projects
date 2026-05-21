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
    seed: 'rel-seed',
    subTick: 0,
    lastAcknowledgedGameDay: 0,
    favors: 3,
    favorsLastRegenGameDay: 0,
    markedNpcIds: [],
    coin: 200,
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

function runThrough(runner: ThreadRunner, lastDay: number) {
  for (let d = 2; d <= lastDay; d += 1) {
    runner.runDay(d, fakeWorld(d), 'rel-seed');
  }
}

describe('relationship archetype', () => {
  it('a friendship runs forming → established → completed with named notes', () => {
    const { p, runner } = build();
    const thread = runner.startThread({
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

    const final = p.loadAllThreads().find((t) => t.id === thread.id) as Thread;
    expect(final.status).toBe('completed');
    const notes = final.history.map((h) => h.note);
    expect(
      notes.some(
        (n) =>
          n.includes('friendship has taken root') &&
          n.includes('Borin') &&
          n.includes('Sera'),
      ),
    ).toBe(true);
    expect(notes.some((n) => n.includes('fast friends'))).toBe(true);
  });

  it('a feud uses enmity language', () => {
    const { p, runner } = build();
    const thread = runner.startThread({
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

    const final = p.loadAllThreads().find((t) => t.id === thread.id) as Thread;
    expect(final.status).toBe('completed');
    const notes = final.history.map((h) => h.note).join(' ');
    expect(notes).toContain('bad blood');
    expect(notes).toContain('enmity');
  });
});
