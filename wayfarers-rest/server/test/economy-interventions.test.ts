import { describe, expect, it } from 'vitest';
import type { WorldState } from '@shared/types';
import { debitCoin } from '../src/economy/ledger.ts';
import {
  buildRestockLarder,
  LARDER_MAX,
} from '../src/interventions/kinds/restock-larder.ts';
import {
  buildUpgradeHearth,
  HEARTH_MAX,
} from '../src/interventions/kinds/upgrade-hearth.ts';
import type {
  InterventionApplyInput,
  InterventionOptions,
} from '../src/interventions/types.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { WorldStateManager } from '../src/state.ts';

function stateManager(overrides: Partial<WorldState> = {}): WorldStateManager {
  const sm = new WorldStateManager(
    new Persistence(':memory:'),
    new FakeClock(Date.parse('2026-01-01T00:00:00.000Z')),
    () => 'verb-seed',
  );
  if (Object.keys(overrides).length) {
    sm.setState({ ...sm.getState(), ...overrides });
  }
  return sm;
}

// The economic verbs ignore the apply/validate/describe arguments entirely;
// these stubs satisfy the types without building real helpers/options.
const OPTIONS = {} as InterventionOptions;
const applyInput = (
  state: WorldState,
): InterventionApplyInput<Record<string, never>> =>
  ({
    payload: {},
    helpers: {} as never,
    state,
    options: OPTIONS,
    gameDay: state.gameDay,
  });

describe('debitCoin', () => {
  it('debits the purse for a deliberate purchase', () => {
    const sm = stateManager();
    const before = sm.getState().coin;
    debitCoin(sm, 50);
    expect(sm.getState().coin).toBe(before - 50);
  });

  it('throws and leaves the purse untouched when coin is short', () => {
    const sm = stateManager({ coin: 10 });
    expect(() => debitCoin(sm, 50)).toThrow(/not enough coin/);
    expect(sm.getState().coin).toBe(10);
  });
});

describe('restock_larder', () => {
  it('is a coin-costed verb', () => {
    const def = buildRestockLarder({ stateManager: stateManager() });
    expect(def.kind).toBe('restock_larder');
    expect(def.costCurrency).toBe('coin');
    expect(def.cost).toBeGreaterThan(0);
  });

  it('raises larderStock by one and reports the new level', () => {
    const sm = stateManager();
    const def = buildRestockLarder({ stateManager: sm });
    expect(def.validate({}, sm.getState(), OPTIONS).ok).toBe(true);
    const effect = def.apply(applyInput(sm.getState()));
    expect(effect.larderRestockedTo).toBe(1);
    expect(sm.getState().larderStock).toBe(1);
  });

  it('is rejected once the larder is full', () => {
    const sm = stateManager({ larderStock: LARDER_MAX });
    const def = buildRestockLarder({ stateManager: sm });
    const result = def.validate({}, sm.getState(), OPTIONS);
    expect(result.ok).toBe(false);
  });

  it('never exceeds the cap', () => {
    const sm = stateManager({ larderStock: LARDER_MAX - 1 });
    const def = buildRestockLarder({ stateManager: sm });
    def.apply(applyInput(sm.getState()));
    expect(sm.getState().larderStock).toBe(LARDER_MAX);
  });

  it('describe() renders the apply-time effect, not live state', () => {
    // The larder has since moved on (decayed/restocked); describe is called
    // post-hoc in the chronicle and must ignore current state.
    const sm = stateManager({ larderStock: LARDER_MAX });
    const def = buildRestockLarder({ stateManager: sm });
    const text = def.describe({}, OPTIONS, { larderRestockedTo: 2 });
    expect(text).toBe(`You restocked the larder (now at 2/${LARDER_MAX}).`);
  });

  it('describe() falls back to a level-free line with no effect', () => {
    const def = buildRestockLarder({ stateManager: stateManager() });
    expect(def.describe({}, OPTIONS, undefined)).toBe(
      'You restocked the larder.',
    );
  });
});

describe('upgrade_hearth', () => {
  it('is a coin-costed verb', () => {
    const def = buildUpgradeHearth({ stateManager: stateManager() });
    expect(def.kind).toBe('upgrade_hearth');
    expect(def.costCurrency).toBe('coin');
  });

  it('raises hearthLevel by one and reports the new level', () => {
    const sm = stateManager();
    const def = buildUpgradeHearth({ stateManager: sm });
    const effect = def.apply(applyInput(sm.getState()));
    expect(effect.hearthUpgradedTo).toBe(1);
    expect(sm.getState().hearthLevel).toBe(1);
  });

  it('is rejected once the hearth is fully built up', () => {
    const sm = stateManager({ hearthLevel: HEARTH_MAX });
    const def = buildUpgradeHearth({ stateManager: sm });
    expect(def.validate({}, sm.getState(), OPTIONS).ok).toBe(false);
  });

  it('never exceeds the cap', () => {
    const sm = stateManager({ hearthLevel: HEARTH_MAX - 1 });
    const def = buildUpgradeHearth({ stateManager: sm });
    def.apply(applyInput(sm.getState()));
    expect(sm.getState().hearthLevel).toBe(HEARTH_MAX);
  });

  it('describe() renders the apply-time effect, not live state', () => {
    const sm = stateManager({ hearthLevel: HEARTH_MAX });
    const def = buildUpgradeHearth({ stateManager: sm });
    const text = def.describe({}, OPTIONS, { hearthUpgradedTo: 3 });
    expect(text).toBe(
      `You built up the hearth and common room (now at 3/${HEARTH_MAX}).`,
    );
  });
});
