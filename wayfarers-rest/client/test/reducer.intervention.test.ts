import { describe, expect, it } from 'vitest';
import type {
  InterventionOptionsResponse,
  InterventionRecord,
} from '@shared/types';
import { initialState, reducer } from '../src/state/reducer.ts';

const SAMPLE_OPTIONS: InterventionOptionsResponse = {
  favors: 3,
  favorsMax: 5,
  kinds: [
    { kind: 'plant_rumor', cost: 1, available: true },
    { kind: 'beckon', cost: 1, available: true },
    { kind: 'sway_thread', cost: 1, available: false, unavailableReason: 'no swayable threads' },
    { kind: 'stir_world', cost: 2, available: true },
    { kind: 'mark_npc', cost: 1, available: true },
  ],
  targets: {
    locations: [],
    archetypes: [],
    activeThreads: [],
    worldTags: [],
    npcsInTavern: [],
  },
  rumorsForBeckoning: [],
};

const SAMPLE_RECORD: InterventionRecord = {
  id: 'int_d3_0',
  kind: 'mark_npc',
  gameDay: 3,
  realTimestamp: '2026-01-03T00:00:00.000Z',
  cost: 1,
  payload: { npcId: 'npc_x' },
  effect: { markedNpcId: 'npc_x' },
};

describe('intervention reducer slices', () => {
  it('INTERVENTION_OPTIONS_LOADED caches options', () => {
    const next = reducer(initialState, {
      type: 'INTERVENTION_OPTIONS_LOADED',
      payload: SAMPLE_OPTIONS,
    });
    expect(next.interventionOptions).toBe(SAMPLE_OPTIONS);
  });

  it('INTERVENTION_PICKER_OPENED + CLOSED toggle the panel', () => {
    const a = reducer(initialState, { type: 'INTERVENTION_PICKER_OPENED' });
    expect(a.interventionPickerOpen).toBe(true);
    const b = reducer(a, { type: 'INTERVENTION_PICKER_CLOSED' });
    expect(b.interventionPickerOpen).toBe(false);
  });

  it('INTERVENTION_LANDED appends to recentInterventions and starts the landing animation', () => {
    const before = Date.now();
    const next = reducer(initialState, {
      type: 'INTERVENTION_LANDED',
      payload: SAMPLE_RECORD,
    });
    expect(next.recentInterventions).toHaveLength(1);
    expect(next.recentInterventions[0]).toBe(SAMPLE_RECORD);
    expect(next.landingAnimationUntil).toBeGreaterThan(before);
  });

  it('INTERVENTION_LANDED prepends newest-first and caps the buffer at 20', () => {
    let state = initialState;
    for (let i = 0; i < 25; i += 1) {
      state = reducer(state, {
        type: 'INTERVENTION_LANDED',
        payload: { ...SAMPLE_RECORD, id: `int_d${i}_0`, gameDay: i },
      });
    }
    expect(state.recentInterventions).toHaveLength(20);
    expect(state.recentInterventions[0].id).toBe('int_d24_0');
  });
});
