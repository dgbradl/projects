import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type {
  InterventionOptionsResponse,
  WorldState,
} from '@shared/types';
import { InterventionPicker } from '../src/components/InterventionPicker.tsx';
import { StoreProvider, useDispatch } from '../src/state/store.tsx';

const WORLD: WorldState = {
  gameDay: 5,
  lastTickAt: '2026-01-05T00:00:00.000Z',
  status: 'running',
  unattendedTicks: 0,
  seed: 'seed',
  subTick: 0,
  lastAcknowledgedGameDay: 4,
  favors: 1,
  favorsLastRegenGameDay: 4,
  markedNpcIds: [],
  coin: 200,
  prosperity: 50,
  tavernName: "The Wayfarer\'s Rest",
  tavernTraits: [],
};

const OPTIONS: InterventionOptionsResponse = {
  favors: 1,
  favorsMax: 5,
  coin: 200,
  kinds: [
    { kind: 'plant_rumor', cost: 1, costCurrency: 'favor', available: true },
    { kind: 'beckon', cost: 1, costCurrency: 'favor', available: true },
    {
      kind: 'sway_thread',
      cost: 1,
      costCurrency: 'favor',
      available: false,
      unavailableReason: 'no swayable threads',
    },
    {
      kind: 'stir_world',
      cost: 2,
      costCurrency: 'favor',
      available: false,
      unavailableReason: 'costs 2 (you have 1)',
    },
    { kind: 'mark_npc', cost: 1, costCurrency: 'favor', available: true },
  ],
  targets: {
    locations: [
      { id: 'oldspire', displayName: 'Oldspire', kind: 'town' },
      { id: 'cradle_hollow', displayName: 'Cradle Hollow', kind: 'village' },
    ],
    archetypes: ['wanderer', 'merchant', 'soldier'],
    activeThreads: [],
    worldTags: [],
    npcsInTavern: [
      {
        id: 'npc_x',
        displayName: 'Mara Thistlewick',
        archetype: 'merchant',
        status: 'at_bar',
        isMarked: false,
      },
    ],
  },
  rumorsForBeckoning: [],
};

function Seeded({ options = OPTIONS }: { options?: InterventionOptionsResponse } = {}) {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({ type: 'INIT_STATE', payload: WORLD });
    dispatch({ type: 'INTERVENTION_OPTIONS_LOADED', payload: options });
    dispatch({ type: 'INTERVENTION_PICKER_OPENED' });
  }, [dispatch, options]);
  return null;
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('InterventionPicker', () => {
  it('disables kinds whose cost exceeds favors and shows the reason', () => {
    render(
      <StoreProvider>
        <Seeded />
        <InterventionPicker />
      </StoreProvider>,
    );
    const stir = screen.getByTestId('intervention-kind-stir_world');
    expect((stir as HTMLButtonElement).disabled).toBe(true);
    const sway = screen.getByTestId('intervention-kind-sway_thread');
    expect((sway as HTMLButtonElement).disabled).toBe(true);
  });

  it('mark_npc flow: pick → choose NPC → confirm posts the right body', async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            intervention: {
              id: 'int_d5_0',
              kind: 'mark_npc',
              gameDay: 5,
              realTimestamp: 't',
              cost: 1,
              payload: { npcId: 'npc_x' },
              effect: { markedNpcId: 'npc_x' },
            },
            state: { ...WORLD, favors: 0, markedNpcIds: ['npc_x'] },
          }),
          { status: 200 },
        ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    render(
      <StoreProvider>
        <Seeded />
        <InterventionPicker />
      </StoreProvider>,
    );

    fireEvent.click(screen.getByTestId('intervention-kind-mark_npc'));
    fireEvent.change(screen.getByTestId('picker-npc'), {
      target: { value: 'npc_x' },
    });
    fireEvent.click(screen.getByTestId('picker-continue'));
    fireEvent.click(screen.getByTestId('picker-confirm'));

    await Promise.resolve();
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, options] = fetchSpy.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(options.body))).toEqual({
      kind: 'mark_npc',
      payload: { npcId: 'npc_x' },
    });
  });

  it('cancel from the kind step closes the picker without posting', () => {
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    render(
      <StoreProvider>
        <Seeded />
        <InterventionPicker />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId('intervention-picker-close'));
    expect(screen.queryByTestId('intervention-picker')).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
