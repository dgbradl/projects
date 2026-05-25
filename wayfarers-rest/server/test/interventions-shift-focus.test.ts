/**
 * Phase 9 (G4): shift_focus intervention tests.
 *
 * Validates: known traits only, dropTrait must be owned, addTrait must not
 * be, no-op rejection, apply replaces the right trait in place, emits
 * tavern_named with the new set.
 */
import { describe, expect, it } from 'vitest';
import type { TavernTrait, WorldEvent, WorldState } from '@shared/types';
import { DEFAULT_TAVERN_NAME } from '@shared/types';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { buildShiftFocus } from '../src/interventions/kinds/shift-focus.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';

const NOW = Date.parse('2026-01-01T00:00:00.000Z');

function build(initialTraits: TavernTrait[] = []) {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(NOW);
  const stateManager = new WorldStateManager(persistence, clock, () => 'g4-seed');
  // Seed the initial traits on the fresh state.
  stateManager.setState({
    ...stateManager.getState(),
    tavernName: DEFAULT_TAVERN_NAME,
    tavernTraits: initialTraits,
  });
  const bus = new WorldEventBus(persistence, clock);
  const def = buildShiftFocus({ stateManager, bus });
  const captured: WorldEvent[] = [];
  bus.on('world_event', (entry: { event: WorldEvent }) =>
    captured.push(entry.event),
  );
  return { persistence, stateManager, bus, def, captured };
}

function emptyOptions() {
  return { state: {} as never, targets: {} as never, availableRumors: [] };
}

describe('shift_focus — validation', () => {
  it('rejects payload missing fields', () => {
    const h = build(['bardic_stage']);
    const state = h.stateManager.getState();
    const r = h.def.validate({} as never, state, emptyOptions());
    expect(r.ok).toBe(false);
  });

  it('rejects unknown drop trait', () => {
    const h = build(['bardic_stage']);
    const r = h.def.validate(
      { dropTrait: 'not_a_trait', addTrait: 'arcane_haven' },
      h.stateManager.getState(),
      emptyOptions(),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects unknown add trait', () => {
    const h = build(['bardic_stage']);
    const r = h.def.validate(
      { dropTrait: 'bardic_stage', addTrait: 'not_a_trait' },
      h.stateManager.getState(),
      emptyOptions(),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects the no-op (drop = add)', () => {
    const h = build(['bardic_stage']);
    const r = h.def.validate(
      { dropTrait: 'bardic_stage', addTrait: 'bardic_stage' },
      h.stateManager.getState(),
      emptyOptions(),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects dropping a trait the tavern does not have', () => {
    const h = build(['bardic_stage']);
    const r = h.def.validate(
      { dropTrait: 'scholars_quiet', addTrait: 'arcane_haven' },
      h.stateManager.getState(),
      emptyOptions(),
    );
    expect(r.ok).toBe(false);
  });

  it('rejects adding a trait the tavern already has', () => {
    const h = build(['bardic_stage', 'arcane_haven']);
    const r = h.def.validate(
      { dropTrait: 'bardic_stage', addTrait: 'arcane_haven' },
      h.stateManager.getState(),
      emptyOptions(),
    );
    expect(r.ok).toBe(false);
  });

  it('accepts a valid shift', () => {
    const h = build(['bardic_stage']);
    const r = h.def.validate(
      { dropTrait: 'bardic_stage', addTrait: 'arcane_haven' },
      h.stateManager.getState(),
      emptyOptions(),
    );
    expect(r.ok).toBe(true);
  });
});

describe('shift_focus — apply', () => {
  it('replaces dropTrait with addTrait in-place + emits tavern_named', () => {
    const h = build(['bardic_stage', 'scholars_quiet']);
    h.def.apply({
      payload: { dropTrait: 'bardic_stage', addTrait: 'arcane_haven' },
      helpers: {} as never,
      state: h.stateManager.getState(),
      options: emptyOptions(),
      gameDay: 7,
    });

    const next = h.stateManager.getState();
    expect(next.tavernTraits).toEqual(['arcane_haven', 'scholars_quiet']);

    const named = h.captured.find((e) => e.type === 'tavern_named');
    expect(named).toBeDefined();
    const ev = named as WorldEvent & { type: 'tavern_named' };
    expect(ev.tavernTraits).toEqual(['arcane_haven', 'scholars_quiet']);
    expect(ev.gameDay).toBe(7);
  });

  it('handles single-trait tavern', () => {
    const h = build(['martial_billet']);
    h.def.apply({
      payload: { dropTrait: 'martial_billet', addTrait: 'pilgrims_pause' },
      helpers: {} as never,
      state: h.stateManager.getState(),
      options: emptyOptions(),
      gameDay: 2,
    });
    expect(h.stateManager.getState().tavernTraits).toEqual(['pilgrims_pause']);
  });

  it('describe reads the payload (post-hoc safe)', () => {
    const h = build(['bardic_stage']);
    const text = h.def.describe(
      { dropTrait: 'bardic_stage', addTrait: 'arcane_haven' },
      emptyOptions(),
    );
    expect(text).toContain('bardic stage');
    expect(text).toContain('arcane haven');
  });
});

describe('shift_focus — cost', () => {
  it('costs 3 favors', () => {
    const h = build(['bardic_stage']);
    expect(h.def.cost).toBe(3);
    // costCurrency is unset → defaults to 'favor' per registry.costCurrencyOf.
    expect((h.def as { costCurrency?: string }).costCurrency).toBeUndefined();
  });
});
