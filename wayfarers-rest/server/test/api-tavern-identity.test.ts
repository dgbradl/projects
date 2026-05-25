/**
 * Phase 8 (D2): tests for POST /tavern/identity.
 *
 * Validates name + traits, writes to WorldState, emits tavern_named.
 */
import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { TavernTrait } from '@shared/types';
import { registerRoutes, type ApiDeps } from '../src/api/routes.ts';
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
  const stateManager = new WorldStateManager(persistence, clock, () => 'identity-seed');
  const bus = new WorldEventBus(persistence, clock);
  const npcManager = new NpcManager(
    { worldSeed: 'identity-seed', subTicksPerDay: SUB_TICKS_PER_DAY },
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
  const app = Fastify();
  registerRoutes(app, deps);
  return { app, persistence, stateManager, bus };
}

describe('POST /tavern/identity', () => {
  it('accepts a valid name and two traits, writes to state, emits tavern_named', async () => {
    const h = build();
    const traits: TavernTrait[] = ['bardic_stage', 'arcane_haven'];
    const res = await h.app.inject({
      method: 'POST',
      url: '/tavern/identity',
      payload: { tavernName: 'The Salted Crow', tavernTraits: traits },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tavernName: string; tavernTraits: string[] };
    expect(body.tavernName).toBe('The Salted Crow');
    expect(body.tavernTraits).toEqual(traits);

    const state = h.stateManager.getState();
    expect(state.tavernName).toBe('The Salted Crow');
    expect(state.tavernTraits).toEqual(traits);

    const events = h.persistence.getEventsSince(0);
    const named = events.find((e) => e.event.type === 'tavern_named');
    expect(named).toBeDefined();
    await h.app.close();
    h.persistence.close();
  });

  it('rejects empty names', async () => {
    const h = build();
    const res = await h.app.inject({
      method: 'POST',
      url: '/tavern/identity',
      payload: { tavernName: '   ', tavernTraits: [] },
    });
    expect(res.statusCode).toBe(400);
    await h.app.close();
    h.persistence.close();
  });

  it('rejects too many traits', async () => {
    const h = build();
    const res = await h.app.inject({
      method: 'POST',
      url: '/tavern/identity',
      payload: {
        tavernName: 'X',
        tavernTraits: ['bardic_stage', 'arcane_haven', 'martial_billet'],
      },
    });
    expect(res.statusCode).toBe(400);
    await h.app.close();
    h.persistence.close();
  });

  it('rejects unknown trait strings', async () => {
    const h = build();
    const res = await h.app.inject({
      method: 'POST',
      url: '/tavern/identity',
      payload: { tavernName: 'X', tavernTraits: ['not_a_trait'] },
    });
    expect(res.statusCode).toBe(400);
    await h.app.close();
    h.persistence.close();
  });

  it('deduplicates repeated traits without erroring', async () => {
    const h = build();
    const res = await h.app.inject({
      method: 'POST',
      url: '/tavern/identity',
      payload: { tavernName: 'X', tavernTraits: ['bardic_stage', 'bardic_stage'] },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { tavernTraits: string[] };
    expect(body.tavernTraits).toEqual(['bardic_stage']);
    await h.app.close();
    h.persistence.close();
  });
});
