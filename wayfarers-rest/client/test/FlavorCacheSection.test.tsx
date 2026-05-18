import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { FlavorPoolStatus, WorldSnapshot, WorldState } from '@shared/types';
import { DebugPanel } from '../src/components/DebugPanel.tsx';
import { StoreProvider, useDispatch } from '../src/state/store.tsx';

const WORLD: WorldState = {
  gameDay: 1,
  lastTickAt: '2026-01-01T00:00:00.000Z',
  status: 'running',
  unattendedTicks: 0,
  seed: 's',
  subTick: 0,
  lastAcknowledgedGameDay: 0,
};

const EMPTY_SNAPSHOT: WorldSnapshot = {
  worldTags: [],
  threads: [],
  pendingArrivals: [],
  rumors: [],
};

const POOLS: FlavorPoolStatus[] = [
  {
    kind: 'arrival',
    subKey: 'wanderer',
    size: 5,
    target: 5,
    refillThreshold: 2,
    recentFailures: 0,
  },
  {
    kind: 'arrival',
    subKey: 'merchant',
    size: 1,
    target: 5,
    refillThreshold: 2,
    recentFailures: 0,
  },
  {
    kind: 'fragment',
    subKey: '',
    size: 0,
    target: 50,
    refillThreshold: 15,
    recentFailures: 2,
  },
];

function Seeded() {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({ type: 'INIT_STATE', payload: WORLD });
    dispatch({ type: 'WORLD_SNAPSHOT', payload: EMPTY_SNAPSHOT });
    dispatch({ type: 'FLAVOR_STATUS', payload: { mode: 'llm', pools: POOLS } });
  }, [dispatch]);
  return null;
}

describe('DebugPanel flavor section', () => {
  it('renders pool sizes with the right state class', () => {
    render(
      <StoreProvider>
        <Seeded />
        <DebugPanel />
      </StoreProvider>,
    );
    const ok = screen.getByTestId('flavor-pool-arrival-wanderer');
    expect(ok.className).toContain('flavor-pool-ok');
    const low = screen.getByTestId('flavor-pool-arrival-merchant');
    expect(low.className).toContain('flavor-pool-low');
    const empty = screen.getByTestId('flavor-pool-fragment-');
    expect(empty.className).toContain('flavor-pool-empty');
  });

  it('displays the current flavor mode', () => {
    render(
      <StoreProvider>
        <Seeded />
        <DebugPanel />
      </StoreProvider>,
    );
    const section = screen.getByTestId('debug-flavor');
    expect(section.textContent).toContain('mode: llm');
  });

  it('expanding the rumors section reveals rumor texts', () => {
    function SeedRumors() {
      const dispatch = useDispatch();
      useEffect(() => {
        dispatch({ type: 'INIT_STATE', payload: WORLD });
        dispatch({
          type: 'WORLD_SNAPSHOT',
          payload: {
            ...EMPTY_SNAPSHOT,
            rumors: [
              {
                id: 'rumor_d2_0',
                text: 'They say the bells of Oldspire rang twice for nothing.',
                introducedGameDay: 2,
                available: true,
              },
            ],
          },
        });
      }, [dispatch]);
      return null;
    }
    render(
      <StoreProvider>
        <SeedRumors />
        <DebugPanel />
      </StoreProvider>,
    );
    const section = screen.getByTestId('debug-rumors');
    fireEvent.click(section.querySelector('summary')!);
    expect(section.textContent).toContain('Oldspire');
  });
});
