import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { Zone } from '@shared/types';
import { ZoneOverlay } from '../src/components/ZoneOverlay.tsx';
import { StoreProvider, useDispatch } from '../src/state/store.tsx';

function Seeder({ zones, enabled }: { zones: Zone[]; enabled: boolean }) {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({ type: 'ZONES_SET', payload: zones });
    if (enabled) dispatch({ type: 'DEBUG_ZONES_TOGGLED' });
  }, [dispatch, zones, enabled]);
  return null;
}

function renderOverlay(zones: Zone[], enabled: boolean) {
  return render(
    <StoreProvider>
      <Seeder zones={zones} enabled={enabled} />
      <ZoneOverlay />
    </StoreProvider>,
  );
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
  globalThis.fetch = vi.fn(
    async () => new Response('null', { status: 200 }),
  ) as unknown as typeof globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe('ZoneOverlay', () => {
  it('renders nothing when debug zones are disabled', () => {
    renderOverlay([{ name: 'bar', x: 50, y: 20, radius: 12 }], false);
    expect(screen.queryByTestId('zone-overlay')).toBeNull();
  });

  it('renders a dashed circle + handles + delete per zone when enabled', () => {
    renderOverlay(
      [
        { name: 'bar', x: 50, y: 20, radius: 12 },
        { name: 'hearth', x: 16, y: 50, radius: 8 },
      ],
      true,
    );
    expect(screen.getByTestId('zone-overlay')).toBeTruthy();
    for (const name of ['bar', 'hearth']) {
      expect(screen.getByTestId(`zone-${name}`)).toBeTruthy();
      expect(screen.getByTestId(`zone-move-${name}`)).toBeTruthy();
      expect(screen.getByTestId(`zone-resize-${name}`)).toBeTruthy();
      expect(screen.getByTestId(`zone-delete-${name}`)).toBeTruthy();
    }
  });

  it('fires DELETE /zones/:name when the delete button is clicked', async () => {
    renderOverlay([{ name: 'snug', x: 70, y: 80, radius: 4 }], true);
    await act(async () => {
      fireEvent.click(screen.getByTestId('zone-delete-snug'));
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/zones/snug',
      expect.objectContaining({ method: 'DELETE' }),
    );
    // optimistic removal: the zone div is gone from the DOM
    expect(screen.queryByTestId('zone-snug')).toBeNull();
  });

  it('places the circle at the zone center with width = radius*2 percent', () => {
    renderOverlay([{ name: 'bar', x: 50, y: 20, radius: 12 }], true);
    const el = screen.getByTestId('zone-bar') as HTMLElement;
    expect(el.style.left).toBe('50%');
    expect(el.style.top).toBe('20%');
    expect(el.style.width).toBe('24%');
    expect(el.style.height).toBe('24%');
  });
});
