import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import type { Npc } from '@shared/types';
import { NpcSprite } from '../src/sprites/NpcSprite.tsx';
import { StoreProvider } from '../src/state/store.tsx';

const NPC: Npc = {
  id: 'n1',
  displayName: 'N',
  status: 'seated',
  position: { x: 50, y: 50 },
  zone: 'bar',
  arrivedGameDay: 1,
  arrivedSubTick: 0,
  plannedDepartureGameDay: 2,
  plannedDepartureSubTick: 0,
  nextDecisionSubTick: 99,
  carriedRumorIds: [],
  archetype: 'merchant',
};

const STAFF_NPC: Npc = {
  ...NPC,
  id: 'staff_bartender_mirela',
  displayName: 'Mirela',
  isStaff: true,
  staffRole: 'bartender',
};

describe('NpcSprite', () => {
  it('falls back to the status dot when the archetype has no sheet', () => {
    // No sheets ship in the repo, so every archetype hits the fallback path.
    const { container } = render(
      <StoreProvider>
        <NpcSprite npc={NPC} />
      </StoreProvider>,
    );
    expect(container.querySelector('.npc-dot')).toBeTruthy();
    expect(container.querySelector('.npc-sprite')).toBeNull();
  });

  it('falls back to the status dot for staff with no sheet', () => {
    const { container } = render(
      <StoreProvider>
        <NpcSprite npc={STAFF_NPC} />
      </StoreProvider>,
    );
    expect(container.querySelector('.npc-dot')).toBeTruthy();
    expect(container.querySelector('.npc-sprite')).toBeNull();
  });
});
