import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { Npc } from '@shared/types';
import { InteractionBubble } from '../src/components/InteractionBubble.tsx';
import { StoreProvider, useDispatch } from '../src/state/store.tsx';

const NPC_A: Npc = {
  id: 'npc_a',
  displayName: 'A',
  status: 'seated',
  position: { x: 50, y: 50 },
  zone: 'bar',
  arrivedGameDay: 1,
  arrivedSubTick: 0,
  plannedDepartureGameDay: 2,
  plannedDepartureSubTick: 0,
  nextDecisionSubTick: 99,
  carriedRumorIds: [],
};

const NPC_B: Npc = { ...NPC_A, id: 'npc_b', displayName: 'B' };

function Seeded({
  expiresAt,
  text,
  npcIds,
}: {
  expiresAt: number;
  text: string;
  npcIds: string[];
}) {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({
      type: 'INTERACTION_FLASH',
      payload: { npcIds, expiresAt, overheardText: text },
    });
  }, [dispatch, expiresAt, text, npcIds]);
  return null;
}

describe('InteractionBubble', () => {
  it('renders the overheard text above the first participant only', () => {
    const future = Date.now() + 60_000;
    render(
      <StoreProvider>
        <Seeded
          expiresAt={future}
          text="and then he says that is not a lute"
          npcIds={['npc_a', 'npc_b']}
        />
        <InteractionBubble npc={NPC_A} />
        <InteractionBubble npc={NPC_B} />
      </StoreProvider>,
    );
    expect(screen.getByTestId('interaction-bubble-npc_a')).toBeTruthy();
    expect(screen.queryByTestId('interaction-bubble-npc_b')).toBeNull();
    expect(
      screen.getByTestId('interaction-bubble-npc_a').textContent,
    ).toContain('that is not a lute');
  });

  it('disappears once the flash expires (after EXPIRE action)', async () => {
    const past = Date.now() - 1000;
    render(
      <StoreProvider>
        <Seeded
          expiresAt={past}
          text="quiet now"
          npcIds={['npc_a', 'npc_b']}
        />
        <Expirer />
        <InteractionBubble npc={NPC_A} />
      </StoreProvider>,
    );
    // The expirer dispatches EXPIRE_INTERACTION_FLASHES on mount; after that,
    // the bubble should not be present.
    await act(async () => {
      // Allow the next microtask.
      await Promise.resolve();
    });
    expect(screen.queryByTestId('interaction-bubble-npc_a')).toBeNull();
  });
});

function Expirer() {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({
      type: 'EXPIRE_INTERACTION_FLASHES',
      payload: { now: Date.now() },
    });
  }, [dispatch]);
  return null;
}
