import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { FlavorModeManager } from '../src/llm/mode.ts';
import { OllamaClient } from '../src/llm/ollama.ts';
import { Persistence } from '../src/persistence.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function build() {
  const p = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const bus = new WorldEventBus(p, clock);
  const client = new OllamaClient({
    baseUrl: 'http://localhost:11434',
    model: 'm',
    requestTimeoutMs: 1_000,
  });
  return { p, bus, client };
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('FlavorModeManager', () => {
  it('falls back to placeholder when boot health check fails and emits flavor_mode_changed', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error('no ollama');
    }) as unknown as typeof globalThis.fetch;

    const { p, bus, client } = build();
    const mode = new FlavorModeManager({
      initialMode: 'llm',
      client,
      bus,
      healthCheckIntervalMs: 60_000,
      getGameDay: () => 1,
    });
    expect(mode.getMode()).toBe('llm');
    await mode.runBootHealthCheck();
    expect(mode.getMode()).toBe('placeholder');
    const events = p.getEventsSince(0).map((e) => e.event.type);
    expect(events).toContain('flavor_mode_changed');
  });

  it('stays in llm mode when boot health check passes', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('{}', { status: 200 }),
    ) as unknown as typeof globalThis.fetch;

    const { bus, client } = build();
    const mode = new FlavorModeManager({
      initialMode: 'llm',
      client,
      bus,
      healthCheckIntervalMs: 60_000,
      getGameDay: () => 1,
    });
    await mode.runBootHealthCheck();
    expect(mode.getMode()).toBe('llm');
  });

  it('does not run health check if initialMode is placeholder or recorded', async () => {
    const fetchSpy = vi.fn(
      async () => new Response('{}', { status: 200 }),
    ) as unknown as typeof globalThis.fetch;
    globalThis.fetch = fetchSpy;

    const { bus, client } = build();
    const mode = new FlavorModeManager({
      initialMode: 'placeholder',
      client,
      bus,
      healthCheckIntervalMs: 60_000,
      getGameDay: () => 1,
    });
    await mode.runBootHealthCheck();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(mode.getMode()).toBe('placeholder');
  });

  it('forceMode emits a flavor_mode_changed event', () => {
    const { p, bus, client } = build();
    const mode = new FlavorModeManager({
      initialMode: 'llm',
      client,
      bus,
      healthCheckIntervalMs: 60_000,
      getGameDay: () => 7,
    });
    mode.forceMode('placeholder', 'manual');
    const events = p.getEventsSince(0);
    const change = events.find((e) => e.event.type === 'flavor_mode_changed');
    expect(change).toBeDefined();
    if (change?.event.type === 'flavor_mode_changed') {
      expect(change.event.oldMode).toBe('llm');
      expect(change.event.newMode).toBe('placeholder');
      expect(change.event.reason).toBe('manual');
    }
  });
});
