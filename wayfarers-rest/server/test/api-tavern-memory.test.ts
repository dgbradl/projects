/**
 * Phase 9 (H3): GET /tavern/memory tests.
 *
 * One high-salience event per game day, ordered chronologically.
 * Threshold-filtered so the timeline is moments, not chatter.
 */
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { TavernMemoryResponse } from '@shared/types';
import {
  buildTavernMemoryResponse,
  MEMORY_SCORE_THRESHOLD,
  registerRoutes,
  type ApiDeps,
} from '../src/api/routes.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { TickScheduler } from '../src/tick.ts';

const SUB_TICKS_PER_DAY = 10;
const TICK_INTERVAL = 1000;
const START = Date.parse('2026-01-01T00:00:00.000Z');

function build() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(START);
  const stateManager = new WorldStateManager(persistence, clock, () => 'mem-seed');
  const bus = new WorldEventBus(persistence, clock);
  const npcManager = new NpcManager(
    { worldSeed: 'mem-seed', subTicksPerDay: SUB_TICKS_PER_DAY },
    { persistence, bus },
  );
  const scheduler = new TickScheduler(
    stateManager,
    clock,
    { tickIntervalMs: TICK_INTERVAL, schedulerCheckMs: 100 },
    bus,
  );
  const deps: ApiDeps = {
    stateManager,
    scheduler,
    persistence,
    clock,
    npcManager,
    bus,
    subTickIntervalMs: 100,
    subTicksPerDay: SUB_TICKS_PER_DAY,
  };
  return { persistence, stateManager, bus, deps };
}

describe('MEMORY_SCORE_THRESHOLD', () => {
  it('is higher than the ticker threshold (memory is for capital-M moments)', () => {
    expect(MEMORY_SCORE_THRESHOLD).toBeGreaterThanOrEqual(5);
  });
});

describe('buildTavernMemoryResponse — filter + select', () => {
  it('returns an empty timeline when only low-salience events exist', () => {
    const h = build();
    h.bus.publish({ type: 'init', gameDay: 1 });
    h.bus.publish({ type: 'tick', gameDay: 2 });
    h.bus.publish({ type: 'favor_regenerated', gameDay: 2, newTotal: 5 });
    const res = buildTavernMemoryResponse(h.deps);
    expect(res.entries).toHaveLength(0);
    h.persistence.close();
  });

  it('surfaces a high-salience event (intervention_used scores 9)', () => {
    const h = build();
    h.bus.publish({
      type: 'intervention_used',
      gameDay: 5,
      intervention: {
        id: 'int1',
        kind: 'plant_rumor',
        gameDay: 5,
        realTimestamp: '2026-01-05T00:00:00Z',
        cost: 1,
        costCurrency: 'favor',
        payload: { locationId: 'oldspire' },
        effect: {},
      },
    });
    const res = buildTavernMemoryResponse(h.deps);
    expect(res.entries.length).toBeGreaterThanOrEqual(1);
    h.persistence.close();
  });

  it('keeps only the top scorer per day when several events qualify', () => {
    const h = build();
    // Day 3: a thread_started (4) is below threshold, but a
    // world_tag_changed (8) AND an intervention_used (9) both clear it.
    // The intervention should win.
    h.bus.publish({
      type: 'world_tag_changed',
      gameDay: 3,
      key: 'season',
      oldValue: 'spring',
      newValue: 'summer',
    });
    h.bus.publish({
      type: 'intervention_used',
      gameDay: 3,
      intervention: {
        id: 'int1',
        kind: 'beckon',
        gameDay: 3,
        realTimestamp: '2026-01-03T00:00:00Z',
        cost: 1,
        costCurrency: 'favor',
        payload: { archetype: 'bard' },
        effect: {},
      },
    });
    const res = buildTavernMemoryResponse(h.deps);
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].event.type).toBe('intervention_used');
    h.persistence.close();
  });

  it('returns entries ordered by gameDay ascending', () => {
    const h = build();
    h.bus.publish({
      type: 'intervention_used',
      gameDay: 7,
      intervention: {
        id: 'i7',
        kind: 'beckon',
        gameDay: 7,
        realTimestamp: '2026-01-07T00:00:00Z',
        cost: 1,
        costCurrency: 'favor',
        payload: { archetype: 'bard' },
        effect: {},
      },
    });
    h.bus.publish({
      type: 'intervention_used',
      gameDay: 2,
      intervention: {
        id: 'i2',
        kind: 'beckon',
        gameDay: 2,
        realTimestamp: '2026-01-02T00:00:00Z',
        cost: 1,
        costCurrency: 'favor',
        payload: { archetype: 'bard' },
        effect: {},
      },
    });
    h.bus.publish({
      type: 'intervention_used',
      gameDay: 5,
      intervention: {
        id: 'i5',
        kind: 'beckon',
        gameDay: 5,
        realTimestamp: '2026-01-05T00:00:00Z',
        cost: 1,
        costCurrency: 'favor',
        payload: { archetype: 'bard' },
        effect: {},
      },
    });
    const res = buildTavernMemoryResponse(h.deps);
    const days = res.entries.map((e) => e.gameDay);
    expect(days).toEqual([2, 5, 7]);
    h.persistence.close();
  });

  it('renders prose text for each entry', () => {
    const h = build();
    h.bus.publish({
      type: 'intervention_used',
      gameDay: 1,
      intervention: {
        id: 'int1',
        kind: 'plant_rumor',
        gameDay: 1,
        realTimestamp: '2026-01-01T00:00:00Z',
        cost: 1,
        costCurrency: 'favor',
        payload: { locationId: 'oldspire' },
        effect: {},
      },
    });
    const res = buildTavernMemoryResponse(h.deps);
    expect(res.entries[0].text.length).toBeGreaterThan(0);
    h.persistence.close();
  });
});

describe('GET /tavern/memory — Fastify wiring', () => {
  it('returns a TavernMemoryResponse', async () => {
    const h = build();
    h.bus.publish({
      type: 'intervention_used',
      gameDay: 4,
      intervention: {
        id: 'int',
        kind: 'beckon',
        gameDay: 4,
        realTimestamp: '2026-01-04T00:00:00Z',
        cost: 1,
        costCurrency: 'favor',
        payload: { archetype: 'soldier' },
        effect: {},
      },
    });
    const app = Fastify();
    registerRoutes(app, h.deps);
    try {
      const res = await app.inject({ method: 'GET', url: '/tavern/memory' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as TavernMemoryResponse;
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.entries.length).toBeGreaterThanOrEqual(1);
      expect(body.entries[0].gameDay).toBe(4);
    } finally {
      await app.close();
      h.persistence.close();
    }
  });
});
