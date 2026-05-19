import { describe, expect, it } from 'vitest';
import { WorldEventBus } from '../src/events/emitter.ts';
import { regenerateForDayTick } from '../src/interventions/favor.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';

function build() {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(Date.parse('2026-01-01T00:00:00.000Z'));
  const stateManager = new WorldStateManager(persistence, clock, () => 'favor-seed');
  const bus = new WorldEventBus(persistence, clock);
  return { persistence, stateManager, bus };
}

describe('regenerateForDayTick', () => {
  it('adds one favor on a new day', () => {
    const h = build();
    h.stateManager.setState({ ...h.stateManager.getState(), favors: 2 });
    const fired = regenerateForDayTick(h.stateManager, h.bus, 2);
    expect(fired).toBe(true);
    expect(h.stateManager.getState().favors).toBe(3);
    expect(h.stateManager.getState().favorsLastRegenGameDay).toBe(2);
    const events = h.persistence.getEventsSince(0).map((e) => e.event.type);
    expect(events).toContain('favor_regenerated');
  });

  it('caps at FAVORS_MAX (5 default)', () => {
    const h = build();
    h.stateManager.setState({ ...h.stateManager.getState(), favors: 5 });
    const fired = regenerateForDayTick(h.stateManager, h.bus, 2);
    expect(fired).toBe(false);
    expect(h.stateManager.getState().favors).toBe(5);
    expect(h.persistence.getEventsSince(0).find((e) => e.event.type === 'favor_regenerated')).toBeUndefined();
  });

  it('double-regen on the same day is a no-op', () => {
    const h = build();
    h.stateManager.setState({ ...h.stateManager.getState(), favors: 2 });
    regenerateForDayTick(h.stateManager, h.bus, 2);
    const after1 = h.persistence.getEventsSince(0).length;
    const second = regenerateForDayTick(h.stateManager, h.bus, 2);
    expect(second).toBe(false);
    expect(h.persistence.getEventsSince(0).length).toBe(after1);
    expect(h.stateManager.getState().favors).toBe(3);
  });

  it('emits favor_regenerated only when an increment actually occurred', () => {
    const h = build();
    h.stateManager.setState({ ...h.stateManager.getState(), favors: 5 });
    regenerateForDayTick(h.stateManager, h.bus, 7);
    const fav = h.persistence
      .getEventsSince(0)
      .filter((e) => e.event.type === 'favor_regenerated');
    expect(fav).toHaveLength(0);
    // day marker should still advance so we don't keep retrying
    expect(h.stateManager.getState().favorsLastRegenGameDay).toBe(7);
  });
});
