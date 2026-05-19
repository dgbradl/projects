import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type {
  Rumor,
  ScheduledArrival,
  Thread,
  WorldSnapshot,
  WorldState,
  WorldTag,
} from '@shared/types';
import { DebugPanel } from '../src/components/DebugPanel.tsx';
import { StoreProvider, useDispatch } from '../src/state/store.tsx';
import { useEffect } from 'react';

const TAGS: WorldTag[] = [
  { key: 'season', value: 'spring', setOnGameDay: 1 },
  { key: 'war_in_north', value: 'quiet', setOnGameDay: 1 },
];

const THREADS: Thread[] = [
  {
    id: 'thread_d1_worldly_event_0',
    type: 'worldly_event',
    status: 'active',
    state: 'cued',
    startedGameDay: 1,
    nextTickGameDay: 5,
    payload: {},
    history: [
      { gameDay: 1, state: 'cued', note: 'started' },
      { gameDay: 5, state: 'step_1', note: 'war_in_north → simmering' },
    ],
  },
  {
    id: 'thread_d1_approaching_stranger_0',
    type: 'approaching_stranger',
    status: 'active',
    state: 'traveling',
    startedGameDay: 1,
    nextTickGameDay: 4,
    payload: {},
    history: [],
  },
  {
    id: 'thread_d2_travelers_journey_0',
    type: 'travelers_journey',
    status: 'active',
    state: 'traveling',
    startedGameDay: 2,
    nextTickGameDay: 5,
    payload: {},
    history: [],
  },
];

const ARRIVALS: ScheduledArrival[] = [
  { npcId: 'a1', displayName: 'A One', scheduledGameDay: 4, scheduledSubTick: 5 },
  { npcId: 'a2', displayName: 'A Two', scheduledGameDay: 5, scheduledSubTick: 10 },
  { npcId: 'a3', displayName: 'A Three', scheduledGameDay: 5, scheduledSubTick: 20 },
  { npcId: 'a4', displayName: 'A Four', scheduledGameDay: 6, scheduledSubTick: 0 },
];

const RUMORS: Rumor[] = [];

const SNAPSHOT: WorldSnapshot = {
  worldTags: TAGS,
  threads: THREADS,
  pendingArrivals: ARRIVALS,
  rumors: RUMORS,
};

const WORLD: WorldState = {
  gameDay: 3,
  lastTickAt: '2026-01-01T00:00:00.000Z',
  status: 'running',
  unattendedTicks: 0,
  seed: 's',
  subTick: 0,
  lastAcknowledgedGameDay: 0,
  favors: 3,
  favorsLastRegenGameDay: 0,
  markedNpcIds: [],
};

function Seeded({ children }: { children: React.ReactNode }) {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({ type: 'INIT_STATE', payload: WORLD });
    dispatch({ type: 'WORLD_SNAPSHOT', payload: SNAPSHOT });
  }, [dispatch]);
  return <>{children}</>;
}

describe('DebugPanel', () => {
  it('renders three sections with provided snapshot data', () => {
    render(
      <StoreProvider>
        <Seeded>
          <DebugPanel />
        </Seeded>
      </StoreProvider>,
    );
    const tags = screen.getByTestId('debug-tags');
    expect(within(tags).getByText(/season/)).toBeTruthy();
    expect(within(tags).getByText(/war_in_north/)).toBeTruthy();

    const threads = screen.getByTestId('debug-threads');
    expect(within(threads).getByText(/active threads \(3\)/)).toBeTruthy();
    expect(within(threads).getByText(/worldly_event/)).toBeTruthy();

    const arrivals = screen.getByTestId('debug-arrivals');
    expect(within(arrivals).getByText(/pending arrivals \(4\)/)).toBeTruthy();
  });

  it('expanding a thread reveals its history', () => {
    render(
      <StoreProvider>
        <Seeded>
          <DebugPanel />
        </Seeded>
      </StoreProvider>,
    );
    const toggle = screen.getByTestId('debug-thread-thread_d1_worldly_event_0');
    fireEvent.click(toggle);
    const history = screen.getByTestId(
      'debug-thread-history-thread_d1_worldly_event_0',
    );
    expect(within(history).getByText(/war_in_north → simmering/)).toBeTruthy();
  });

  it('clicking collapse hides the panel and shows the re-open toggle', () => {
    render(
      <StoreProvider>
        <Seeded>
          <DebugPanel />
        </Seeded>
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId('debug-collapse'));
    expect(screen.queryByTestId('debug-panel')).toBeNull();
    expect(screen.getByTestId('debug-toggle')).toBeTruthy();
  });
});
