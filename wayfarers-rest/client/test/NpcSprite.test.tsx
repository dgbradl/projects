import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Npc } from '@shared/types';
import { NpcSprite } from '../src/sprites/NpcSprite.tsx';
import { spriteSheetForNpc } from '../src/sprites/npcSheet.ts';
import { StoreProvider } from '../src/state/store.tsx';

// Mock only the sheet lookup so the test does not depend on which .png files
// happen to be in assets/npc/ — the rest of npcSheet (resolvePose etc.) is real.
vi.mock('../src/sprites/npcSheet.ts', async (importActual) => {
  const actual =
    await importActual<typeof import('../src/sprites/npcSheet.ts')>();
  return { ...actual, spriteSheetForNpc: vi.fn() };
});

const sheetMock = vi.mocked(spriteSheetForNpc);

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

function renderSprite(npc: Npc) {
  return render(
    <StoreProvider>
      <NpcSprite npc={npc} />
    </StoreProvider>,
  );
}

describe('NpcSprite', () => {
  it('falls back to the status dot when the NPC has no sheet', () => {
    sheetMock.mockReturnValue(undefined);
    const { container } = renderSprite(NPC);
    expect(container.querySelector('.npc-dot')).toBeTruthy();
    expect(container.querySelector('.npc-sprite')).toBeNull();
  });

  it('renders an animated sprite when the NPC has a sheet', () => {
    sheetMock.mockReturnValue('/sheets/merchant.png');
    const { container } = renderSprite(NPC);
    const sprite = container.querySelector('.npc-sprite');
    expect(sprite).toBeTruthy();
    expect(container.querySelector('.npc-dot')).toBeNull();
    expect((sprite as HTMLElement).style.backgroundImage).toContain(
      'merchant.png',
    );
  });
});
