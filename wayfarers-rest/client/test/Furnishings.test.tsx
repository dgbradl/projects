import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { FurniturePiece } from '@shared/types';
import { Furnishings, STORAGE_KEY } from '../src/components/Furnishings.tsx';
import {
  StoreProvider,
  useDispatch,
} from '../src/state/store.tsx';

/** Tiny child that dispatches a FURNITURE_SET on mount so each test can
 *  seed the store with whatever pieces it needs without touching network. */
function Seeder({ pieces }: { pieces: FurniturePiece[] }) {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({ type: 'FURNITURE_SET', payload: pieces });
  }, [dispatch, pieces]);
  return null;
}

function renderWithStore(pieces: FurniturePiece[]) {
  return render(
    <StoreProvider>
      <Seeder pieces={pieces} />
      <Furnishings />
    </StoreProvider>,
  );
}

function p(
  overrides: Partial<FurniturePiece> & { id: string },
): FurniturePiece {
  return {
    id: overrides.id,
    sprite: overrides.sprite ?? 'table_round_01',
    x: overrides.x ?? 50,
    y: overrides.y ?? 50,
    rotation: overrides.rotation ?? 0,
    scale: overrides.scale ?? 1,
    layer: overrides.layer ?? 1,
  };
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  localStorage.clear();
  // Skip the legacy-localStorage migration on every test by pre-setting the
  // sentinel; tests that exercise migration explicitly clear it.
  localStorage.setItem('wayfarers.furniture.migrated.v1', '1');
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

function mockFetchOk(body: unknown) {
  return vi.fn(async () =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  ) as unknown as typeof globalThis.fetch;
}

describe('Furnishings', () => {
  it('starts with an empty floor', () => {
    renderWithStore([]);
    expect(
      screen.getByTestId('furnishings').querySelectorAll('.furniture'),
    ).toHaveLength(0);
  });

  it('POSTs to /furniture when a sprite is dropped on the floor', async () => {
    const created = p({ id: 'srv-1', sprite: 'table_round_01', x: 12.5, y: 9, layer: 1 });
    globalThis.fetch = mockFetchOk(created);
    renderWithStore([]);
    const layer = screen.getByTestId('furnishings');
    await act(async () => {
      fireEvent.drop(layer, {
        clientX: 120,
        clientY: 90,
        dataTransfer: { getData: () => 'table_round_01' },
      });
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/furniture',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(layer.querySelectorAll('.furniture')).toHaveLength(1);
    expect(layer.querySelector('[data-testid="furniture-srv-1"]')).toBeTruthy();
  });

  it('reveals rotate / scale / layer handles on the selected piece', () => {
    renderWithStore([p({ id: 'p1' })]);
    expect(screen.queryByTestId('furniture-rotate-p1')).toBeNull();
    fireEvent.pointerDown(screen.getByTestId('furniture-p1'));
    expect(screen.getByTestId('furniture-rotate-p1')).toBeTruthy();
    expect(screen.getByTestId('furniture-scale-p1')).toBeTruthy();
    expect(screen.getByTestId('furniture-layer-p1')).toBeTruthy();
  });

  it('applies a piece scale to its rendered width', () => {
    renderWithStore([
      p({ id: 'big', x: 40, scale: 1 }),
      p({ id: 'small', x: 60, scale: 0.5, layer: 2 }),
    ]);
    const big = parseFloat(screen.getByTestId('furniture-big').style.width);
    const small = parseFloat(screen.getByTestId('furniture-small').style.width);
    expect(small).toBeCloseTo(big / 2);
  });

  it('copies and pastes via the server', async () => {
    const created = p({ id: 'paste-1', sprite: 'table_round_01', x: 54, y: 54, layer: 2 });
    globalThis.fetch = mockFetchOk(created);
    renderWithStore([p({ id: 'p1', x: 50, y: 50 })]);
    fireEvent.pointerDown(screen.getByTestId('furniture-p1'));
    fireEvent.keyDown(document.body, { key: 'c', metaKey: true });
    await act(async () => {
      fireEvent.keyDown(document.body, { key: 'v', metaKey: true });
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      '/furniture',
      expect.objectContaining({ method: 'POST' }),
    );
    const layer = screen.getByTestId('furnishings');
    expect(layer.querySelectorAll('.furniture')).toHaveLength(2);
  });

  it('restacks a piece optimistically via the layer toolbar', async () => {
    const pieces = ['a', 'b', 'c'].map((id, i) =>
      p({ id, layer: i + 1 }),
    );
    // The layer endpoint returns the server's authoritative new order; for
    // this test we let it match the optimistic reorder.
    let lastOrder: FurniturePiece[] = pieces;
    globalThis.fetch = vi.fn(async (_url, init) => {
      const body = init ? JSON.parse((init as RequestInit).body as string) : {};
      // Simulate "back": move last to first, renumber.
      if (body.move === 'back') {
        const reordered = [lastOrder[2], lastOrder[0], lastOrder[1]].map((piece, i) => ({
          ...piece,
          layer: i + 1,
        }));
        lastOrder = reordered;
        return new Response(JSON.stringify(reordered), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;

    renderWithStore(pieces);
    const layerEl = screen.getByTestId('furnishings');
    const order = () =>
      [...layerEl.querySelectorAll('.furniture')].map((el) =>
        el.getAttribute('data-testid'),
      );
    expect(order()).toEqual(['furniture-a', 'furniture-b', 'furniture-c']);

    fireEvent.pointerDown(screen.getByTestId('furniture-c'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('furniture-layer-back-c'));
    });
    expect(order()).toEqual(['furniture-c', 'furniture-a', 'furniture-b']);
    const back = screen.getByTestId('furniture-layer-back-c') as HTMLButtonElement;
    expect(back.disabled).toBe(true);
  });

  it('migrates a pre-existing localStorage layout to the server (once)', async () => {
    localStorage.removeItem('wayfarers.furniture.migrated.v1');
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: 'legacy-a', sprite: 'plant_02', x: 9, y: 78, rotation: 0, scale: 1 },
      ]),
    );
    // First call is GET /furniture (returns empty -> proceed), then POST.
    const calls: string[] = [];
    globalThis.fetch = vi.fn(async (url, init) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      calls.push(`${method} ${url as string}`);
      if (method === 'GET') {
        return new Response('[]', {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify(
          p({ id: 'srv-legacy-a', sprite: 'plant_02', x: 9, y: 78, layer: 1 }),
        ),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof globalThis.fetch;

    await act(async () => {
      renderWithStore([]);
    });
    // give microtasks a tick to flush
    await act(async () => {
      await Promise.resolve();
    });

    expect(calls).toContain('GET /furniture');
    expect(calls).toContain('POST /furniture');
    expect(localStorage.getItem('wayfarers.furniture.migrated.v1')).toBe('1');
  });
});
