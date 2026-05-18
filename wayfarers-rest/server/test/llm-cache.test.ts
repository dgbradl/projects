import { describe, expect, it } from 'vitest';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FlavorCache } from '../src/llm/cache/manager.ts';
import { FlavorWorker } from '../src/llm/cache/worker.ts';
import { FlavorModeManager } from '../src/llm/mode.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function build() {
  const p = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const bus = new WorldEventBus(p, clock);
  const mode = new FlavorModeManager({
    initialMode: 'llm',
    client: null,
    bus,
    healthCheckIntervalMs: 60_000,
    getGameDay: () => 1,
  });
  const cache = new FlavorCache(p, bus, mode);
  return { p, bus, mode, cache };
}

describe('FlavorCache', () => {
  it('take returns placeholder when pool is empty and emits flavor_cache_miss', () => {
    const { p, cache } = build();
    cache.registerPool<{ seed?: string }, string>(
      {
        kind: 'fake',
        subKey: '',
        targetSize: 3,
        refillThreshold: 1,
        generate: async () => 'gen',
      },
      { placeholder: (input) => `ph:${input.seed ?? '?'}` },
    );
    const out = cache.take<{ seed?: string }, string>('fake', {
      placeholderInput: { seed: 'x' },
      gameDay: 1,
    });
    expect(out).toBe('ph:x');
    const events = p.getEventsSince(0).map((e) => e.event.type);
    expect(events).toContain('flavor_cache_miss');
  });

  it('push then take cycles through items in FIFO order and persists deletes', () => {
    const { p, cache } = build();
    cache.registerPool<{ seed?: string }, string>(
      {
        kind: 'fake',
        subKey: '',
        targetSize: 3,
        refillThreshold: 1,
        generate: async () => 'gen',
      },
      { placeholder: () => 'ph' },
    );
    cache.push('fake', '', ['a', 'b', 'c']);
    expect(cache.getPool<string>('fake')!.size()).toBe(3);
    expect(p.loadFlavorCacheItems()).toHaveLength(3);

    expect(cache.take('fake', { placeholderInput: { seed: '?' } })).toBe('a');
    expect(cache.take('fake', { placeholderInput: { seed: '?' } })).toBe('b');
    expect(cache.getPool<string>('fake')!.size()).toBe(1);
    expect(p.loadFlavorCacheItems()).toHaveLength(1);
  });

  it('rehydrate restores pool items from persisted rows', () => {
    const { p, cache } = build();
    cache.registerPool<{ seed?: string }, string>(
      {
        kind: 'fake',
        subKey: '',
        targetSize: 3,
        refillThreshold: 1,
        generate: async () => 'gen',
      },
      { placeholder: () => 'ph' },
    );
    cache.push('fake', '', ['x', 'y']);

    // Build a new cache against the same Persistence and rehydrate.
    const { cache: cache2 } = (() => {
      const clock = new FakeClock(NOW);
      const bus = new WorldEventBus(p, clock);
      const mode = new FlavorModeManager({
        initialMode: 'llm',
        client: null,
        bus,
        healthCheckIntervalMs: 60_000,
        getGameDay: () => 1,
      });
      return { cache: new FlavorCache(p, bus, mode) };
    })();
    cache2.registerPool<{ seed?: string }, string>(
      {
        kind: 'fake',
        subKey: '',
        targetSize: 3,
        refillThreshold: 1,
        generate: async () => 'gen',
      },
      { placeholder: () => 'ph' },
    );
    cache2.rehydrate();
    expect(cache2.getPool<string>('fake')!.size()).toBe(2);
  });

  it('returns placeholder in placeholder mode even when pool has items', () => {
    const { cache, mode } = build();
    cache.registerPool<{ seed?: string }, string>(
      {
        kind: 'fake',
        subKey: '',
        targetSize: 3,
        refillThreshold: 1,
        generate: async () => 'gen',
      },
      { placeholder: (input) => `ph:${input.seed ?? '?'}` },
    );
    cache.push('fake', '', ['a', 'b']);
    mode.forceMode('placeholder', 'test');
    const out = cache.take<{ seed?: string }, string>('fake', {
      placeholderInput: { seed: 'z' },
    });
    expect(out).toBe('ph:z');
    // Pool unchanged in placeholder mode.
    expect(cache.getPool<string>('fake')!.size()).toBe(2);
  });
});

describe('FlavorWorker', () => {
  function buildWithSpies() {
    const { p, bus, mode, cache } = build();
    let calls = 0;
    cache.registerPool<{ seed?: string }, string>(
      {
        kind: 'small',
        subKey: '',
        targetSize: 5,
        refillThreshold: 3,
        generate: async () => {
          calls += 1;
          return `gen-${calls}`;
        },
      },
      { placeholder: () => 'ph' },
    );
    cache.registerPool<{ seed?: string }, string>(
      {
        kind: 'big',
        subKey: '',
        targetSize: 20,
        refillThreshold: 10,
        generate: async () => {
          calls += 1;
          return ['big-a', 'big-b', 'big-c'];
        },
      },
      { placeholder: () => 'ph' },
    );
    const worker = new FlavorWorker(cache, mode, 1_000);
    return { p, bus, mode, cache, worker, getCalls: () => calls };
  }

  it('picks the pool with the largest deficit and generates exactly one batch per tick', async () => {
    const { worker, cache, getCalls } = buildWithSpies();
    await worker.tickOnce();
    // 'big' has a deficit of 20, 'small' has a deficit of 5 → big is picked.
    expect(getCalls()).toBe(1);
    expect(cache.getPool<string>('big')!.size()).toBe(3);
    expect(cache.getPool<string>('small')!.size()).toBe(0);
  });

  it('does not generate when mode is placeholder', async () => {
    const { worker, mode, getCalls } = buildWithSpies();
    mode.forceMode('placeholder', 'test');
    await worker.tickOnce();
    expect(getCalls()).toBe(0);
  });

  it('backs off after a generate failure (skips that pool for 3 ticks)', async () => {
    const { mode, cache } = build();
    let calls = 0;
    cache.registerPool<{ seed?: string }, string>(
      {
        kind: 'flaky',
        subKey: '',
        targetSize: 5,
        refillThreshold: 3,
        generate: async () => {
          calls += 1;
          throw new Error('boom');
        },
      },
      { placeholder: () => 'ph' },
    );
    const worker = new FlavorWorker(cache, mode, 1_000);
    await worker.tickOnce(); // fails, records 3-tick backoff
    expect(calls).toBe(1);

    await worker.tickOnce(); // skipped
    await worker.tickOnce(); // skipped
    await worker.tickOnce(); // skipped
    expect(calls).toBe(1);

    await worker.tickOnce(); // backoff elapsed; runs again
    expect(calls).toBe(2);
  });
});
