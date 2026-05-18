import { describe, expect, it } from 'vitest';
import type { DailyChronicle } from '@shared/types';
import { ChroniclePipeline } from '../src/chronicle/pipeline.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

class StubGenerator {
  public calls: number[] = [];
  constructor(
    private readonly persistence: Persistence,
    private readonly bus: WorldEventBus,
  ) {}

  async generate(gameDay: number): Promise<DailyChronicle> {
    this.calls.push(gameDay);
    const chronicle: DailyChronicle = {
      gameDay,
      generatedAtRealTs: new Date(NOW).toISOString(),
      status: 'complete',
      headlines: ['h1', 'h2', 'h3'],
      footnotes: ['f1', 'f2', 'f3'],
      modelUsed: 'stub',
      promptCharCount: 100,
      completionCharCount: 50,
      generationDurationMs: 1,
      failureReason: null,
    };
    this.persistence.upsertChronicle(chronicle);
    this.bus.publish({
      type: 'chronicle_generated',
      gameDay,
      status: chronicle.status,
      durationMs: 1,
    });
    return chronicle;
  }
}

function build() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const bus = new WorldEventBus(persistence, clock);
  const stateManager = new WorldStateManager(persistence, clock, () => 'pipeline-seed');
  const generator = new StubGenerator(persistence, bus);
  const pipeline = new ChroniclePipeline(
    persistence,
    stateManager,
    generator as unknown as import('../src/chronicle/generator.ts').ChronicleGenerator,
    { workerIntervalMs: 50 },
  );
  return { persistence, clock, bus, stateManager, generator, pipeline };
}

describe('ChroniclePipeline', () => {
  it('day-tick from N to N+1 inserts a pending chronicle for day N', () => {
    const h = build();
    // Advance gameDay to 3; days 1 and 2 should each get a pending row.
    h.stateManager.setState({ ...h.stateManager.getState(), gameDay: 3 });
    const pending = h.persistence.loadPendingChronicleGameDays();
    expect(pending).toEqual([1, 2]);
  });

  it('worker processes pending chronicles serially in order', async () => {
    const h = build();
    h.stateManager.setState({ ...h.stateManager.getState(), gameDay: 4 });
    // 3 pending rows: 1, 2, 3.
    await h.pipeline.tickOnce();
    await h.pipeline.tickOnce();
    await h.pipeline.tickOnce();
    expect(h.generator.calls).toEqual([1, 2, 3]);
    expect(h.persistence.loadPendingChronicleGameDays()).toEqual([]);
  });

  it('runCatchUp enqueues missing past days in order', () => {
    const h = build();
    // Manually advance state without going through setState (simulate restart).
    h.stateManager.setState({ ...h.stateManager.getState(), gameDay: 5 });
    // Wipe pending rows to simulate a Phase 4 DB with no chronicles at all.
    for (let d = 1; d <= 4; d += 1) {
      const row = h.persistence.loadChronicle(d);
      if (row) {
        // delete via raw query
        (h.persistence as unknown as { db: { prepare: (s: string) => { run: (n: number) => unknown } } }).db
          .prepare('DELETE FROM chronicles WHERE game_day = ?')
          .run(d);
      }
    }
    h.pipeline.runCatchUp();
    expect(h.persistence.loadPendingChronicleGameDays()).toEqual([1, 2, 3, 4]);
  });

  it('does not double-process the same day if tickOnce is called concurrently', async () => {
    const h = build();
    h.stateManager.setState({ ...h.stateManager.getState(), gameDay: 2 });
    // Two concurrent calls: the second should see `running = true` and short-circuit.
    const [a, b] = await Promise.all([h.pipeline.tickOnce(), h.pipeline.tickOnce()]);
    // Exactly one should have been processed.
    expect(h.generator.calls.length).toBe(1);
    expect(a?.gameDay ?? b?.gameDay).toBe(1);
  });
});
