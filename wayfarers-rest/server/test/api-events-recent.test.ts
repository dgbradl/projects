/**
 * Phase 8 (B1): tests for GET /events/recent — the live ticker feed.
 *
 * Verifies salience filter (low-score events drop out), prose rendering
 * (uses the chronicle fallback sentences so the ticker and the LLM-off
 * chronicle never diverge), incremental polling via sinceEventId, limit
 * cap, and that lastEventId always advances even when nothing passes.
 */
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { TickerResponse } from '@shared/types';
import { buildTickerResponse, registerRoutes, type ApiDeps } from '../src/api/routes.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { NpcManager } from '../src/npc/manager.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';
import { TickScheduler } from '../src/tick.ts';

const TICK_INTERVAL = 1000;
const SUB_TICKS_PER_DAY = 10;
const START = Date.parse('2026-01-01T00:00:00.000Z');

function build() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(START);
  const stateManager = new WorldStateManager(persistence, clock, () => 'ticker-seed');
  const bus = new WorldEventBus(persistence, clock);
  const npcManager = new NpcManager(
    { worldSeed: 'ticker-seed', subTicksPerDay: SUB_TICKS_PER_DAY },
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
  return { persistence, stateManager, bus, npcManager, deps };
}

describe('buildTickerResponse — salience filter', () => {
  it('drops low-salience events (init, tick, favor_regenerated)', () => {
    const h = build();
    h.bus.publish({ type: 'init', gameDay: 1 });
    h.bus.publish({ type: 'tick', gameDay: 2 });
    h.bus.publish({ type: 'favor_regenerated', gameDay: 2, newTotal: 5 });
    const res = buildTickerResponse(h.deps, { sinceEventId: 0, limit: 50 });
    expect(res.entries).toHaveLength(0);
    // lastEventId still advances so the next poll skips these.
    expect(res.lastEventId).toBeGreaterThan(0);
  });

  it('surfaces npc_arrived as a prose sentence', () => {
    const h = build();
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 1,
      npcId: 'g1',
      displayName: 'Hester',
    });
    const res = buildTickerResponse(h.deps, { sinceEventId: 0, limit: 50 });
    expect(res.entries).toHaveLength(1);
    expect(res.entries[0].text).toContain('Hester');
    expect(res.entries[0].text).toContain('arrived');
    expect(res.entries[0].score).toBeGreaterThanOrEqual(2);
  });

  it('renders desire_fulfilled with keeper credit when applicable', () => {
    const h = build();
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 1,
      npcId: 'lana',
      displayName: 'Lana',
    });
    h.bus.publish({
      type: 'desire_fulfilled',
      gameDay: 1,
      npcId: 'lana',
      desireKind: 'news_of_location',
      param: 'oldspire',
      fulfilledBy: 'keeper:plant_rumor',
    });
    const res = buildTickerResponse(h.deps, { sinceEventId: 0, limit: 50 });
    const desireEntry = res.entries.find(
      (e) => e.event.type === 'desire_fulfilled',
    );
    expect(desireEntry).toBeDefined();
    expect(desireEntry!.text).toContain('Lana');
    expect(desireEntry!.text).toContain('Oldspire');
    expect(desireEntry!.text).toContain("keeper");
  });
});

describe('buildTickerResponse — incremental polling', () => {
  it('returns only events newer than sinceEventId', () => {
    const h = build();
    h.bus.publish({ type: 'npc_arrived', gameDay: 1, npcId: 'a', displayName: 'A' });
    h.bus.publish({ type: 'npc_arrived', gameDay: 1, npcId: 'b', displayName: 'B' });
    const first = buildTickerResponse(h.deps, { sinceEventId: 0, limit: 50 });
    expect(first.entries.length).toBeGreaterThanOrEqual(2);
    const lastId = first.lastEventId;

    // Publish another after the first poll.
    h.bus.publish({ type: 'npc_arrived', gameDay: 1, npcId: 'c', displayName: 'C' });
    const second = buildTickerResponse(h.deps, {
      sinceEventId: lastId,
      limit: 50,
    });
    const cIds = second.entries.map((e) => (e.event as { npcId?: string }).npcId);
    expect(cIds).toContain('c');
    expect(cIds).not.toContain('a');
    expect(cIds).not.toContain('b');
  });

  it('respects the limit cap and reports the highest seen eventId', () => {
    const h = build();
    for (let i = 0; i < 12; i += 1) {
      h.bus.publish({
        type: 'npc_arrived',
        gameDay: 1,
        npcId: `g${i}`,
        displayName: `G${i}`,
      });
    }
    const res = buildTickerResponse(h.deps, { sinceEventId: 0, limit: 5 });
    expect(res.entries.length).toBe(5);
    expect(res.lastEventId).toBeGreaterThan(0);
  });
});

describe('GET /events/recent — Fastify wiring', () => {
  it('returns a TickerResponse with the same shape as the helper', async () => {
    const h = build();
    h.bus.publish({
      type: 'npc_arrived',
      gameDay: 1,
      npcId: 'g1',
      displayName: 'Hester',
    });
    const app = Fastify();
    registerRoutes(app, h.deps);
    try {
      const res = await app.inject({
        method: 'GET',
        url: '/events/recent?sinceEventId=0&limit=10',
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as TickerResponse;
      expect(Array.isArray(body.entries)).toBe(true);
      expect(body.entries.length).toBeGreaterThanOrEqual(1);
      expect(body.entries[0].text).toContain('Hester');
      expect(typeof body.lastEventId).toBe('number');
    } finally {
      await app.close();
      h.persistence.close();
    }
  });
});
