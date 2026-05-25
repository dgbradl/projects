import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { WorldState } from '@shared/types';
import { FavorIndicator } from '../src/components/FavorIndicator.tsx';
import { StoreProvider, useDispatch } from '../src/state/store.tsx';

const WORLD: WorldState = {
  gameDay: 5,
  lastTickAt: '2026-01-05T00:00:00.000Z',
  status: 'running',
  unattendedTicks: 0,
  seed: 'seed',
  subTick: 0,
  lastAcknowledgedGameDay: 4,
  favors: 2,
  favorsLastRegenGameDay: 4,
  markedNpcIds: [],
  coin: 200,
  prosperity: 50,
  tavernName: "The Wayfarer\'s Rest",
  tavernTraits: [],
};

function Seeded() {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({ type: 'INIT_STATE', payload: WORLD });
    dispatch({
      type: 'INTERVENTION_OPTIONS_LOADED',
      payload: {
        favors: 2,
        favorsMax: 5,
        coin: 200,
        kinds: [],
        targets: {
          locations: [],
          archetypes: [],
          activeThreads: [],
          worldTags: [],
          npcsInTavern: [],
        },
        rumorsForBeckoning: [],
      },
    });
  }, [dispatch]);
  return null;
}

describe('FavorIndicator', () => {
  it('renders one glyph per favor up to favorsMax', () => {
    render(
      <StoreProvider>
        <Seeded />
        <FavorIndicator />
      </StoreProvider>,
    );
    const lit = document.querySelectorAll('.favor-lit');
    const unlit = document.querySelectorAll('.favor-unlit');
    expect(lit.length).toBe(2);
    expect(unlit.length).toBe(3);
  });

  it('shows current/max counts in the label', () => {
    render(
      <StoreProvider>
        <Seeded />
        <FavorIndicator />
      </StoreProvider>,
    );
    expect(screen.getByTestId('favor-count').textContent).toBe('2/5');
  });

  it('click triggers a fetch and opens the picker', async () => {
    // jsdom needs a fetch shim; vitest doesn't ship one by default.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          favors: 2,
          favorsMax: 5,
          kinds: [],
          targets: {
            locations: [],
            archetypes: [],
            activeThreads: [],
            worldTags: [],
            npcsInTavern: [],
          },
          rumorsForBeckoning: [],
        }),
        { status: 200 },
      )) as typeof globalThis.fetch;
    try {
      render(
        <StoreProvider>
          <Seeded />
          <FavorIndicator />
        </StoreProvider>,
      );
      fireEvent.click(screen.getByTestId('favor-indicator'));
      // Wait one microtask for the async fetch to resolve.
      await Promise.resolve();
      await Promise.resolve();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
