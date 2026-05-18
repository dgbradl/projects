import { useEffect } from 'react';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type {
  ChroniclesSinceResponse,
  DailyChronicle,
} from '@shared/types';
import { Welcome } from '../src/components/Welcome.tsx';
import { StoreProvider, useDispatch } from '../src/state/store.tsx';

function makeChronicle(
  day: number,
  overrides: Partial<DailyChronicle> = {},
): DailyChronicle {
  return {
    gameDay: day,
    generatedAtRealTs: 'ts',
    status: 'complete',
    headlines: [`d${day} headline 1`, `d${day} headline 2`, `d${day} headline 3`],
    footnotes: [`d${day} footnote 1`, `d${day} footnote 2`, `d${day} footnote 3`],
    modelUsed: 'stub',
    promptCharCount: 0,
    completionCharCount: 0,
    generationDurationMs: 0,
    failureReason: null,
    ...overrides,
  };
}

function SeedWelcome({ payload }: { payload: ChroniclesSinceResponse }) {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch({ type: 'WELCOME_OPENED', payload });
  }, [dispatch, payload]);
  return null;
}

describe('Welcome', () => {
  it('renders prologue when present', () => {
    const payload: ChroniclesSinceResponse = {
      fromGameDay: 1,
      toGameDay: 3,
      chronicles: [makeChronicle(1), makeChronicle(2), makeChronicle(3)],
      pendingDays: [],
      prologue: {
        fromGameDay: 1,
        toGameDay: 3,
        text: 'A heavier week than the last one, in ways I would find hard to name.',
        generatedAtRealTs: 'ts',
        status: 'complete',
      },
    };
    render(
      <StoreProvider>
        <SeedWelcome payload={payload} />
        <Welcome />
      </StoreProvider>,
    );
    const prologue = screen.getByTestId('welcome-prologue');
    expect(prologue.textContent).toContain('heavier week');
  });

  it('omits the prologue when absent', () => {
    const payload: ChroniclesSinceResponse = {
      fromGameDay: 1,
      toGameDay: 2,
      chronicles: [makeChronicle(1), makeChronicle(2)],
      pendingDays: [],
      prologue: null,
    };
    render(
      <StoreProvider>
        <SeedWelcome payload={payload} />
        <Welcome />
      </StoreProvider>,
    );
    expect(screen.queryByTestId('welcome-prologue')).toBeNull();
  });

  it('renders entries with headlines and footnotes', () => {
    const payload: ChroniclesSinceResponse = {
      fromGameDay: 1,
      toGameDay: 2,
      chronicles: [makeChronicle(1), makeChronicle(2)],
      pendingDays: [],
      prologue: null,
    };
    render(
      <StoreProvider>
        <SeedWelcome payload={payload} />
        <Welcome />
      </StoreProvider>,
    );
    const entry1 = screen.getByTestId('welcome-entry-1');
    expect(entry1.textContent).toContain('d1 headline 1');
    expect(entry1.textContent).toContain('d1 footnote 1');
  });

  it('renders pending day as placeholder; CHRONICLE_FILLED swaps in real content', () => {
    function Sequence() {
      const dispatch = useDispatch();
      useEffect(() => {
        dispatch({
          type: 'WELCOME_OPENED',
          payload: {
            fromGameDay: 1,
            toGameDay: 2,
            chronicles: [makeChronicle(1)],
            pendingDays: [2],
            prologue: null,
          },
        });
        setTimeout(() => {
          dispatch({ type: 'CHRONICLE_FILLED', payload: makeChronicle(2) });
        }, 10);
      }, [dispatch]);
      return null;
    }
    render(
      <StoreProvider>
        <Sequence />
        <Welcome />
      </StoreProvider>,
    );
    const day2 = screen.getByTestId('welcome-entry-2');
    expect(day2.textContent).toContain('still being written');
  });

  it('fallback entries get a subtle note', () => {
    const payload: ChroniclesSinceResponse = {
      fromGameDay: 1,
      toGameDay: 1,
      chronicles: [makeChronicle(1, { status: 'fallback' })],
      pendingDays: [],
      prologue: null,
    };
    render(
      <StoreProvider>
        <SeedWelcome payload={payload} />
        <Welcome />
      </StoreProvider>,
    );
    const entry = screen.getByTestId('welcome-entry-1');
    expect(entry.textContent).toContain("no innkeeper");
  });

  it('clicking ledger toggle reveals the ledger placeholder', () => {
    const payload: ChroniclesSinceResponse = {
      fromGameDay: 1,
      toGameDay: 1,
      chronicles: [makeChronicle(1)],
      pendingDays: [],
      prologue: null,
    };
    render(
      <StoreProvider>
        <SeedWelcome payload={payload} />
        <Welcome />
      </StoreProvider>,
    );
    fireEvent.click(screen.getByTestId('welcome-entry-ledger-toggle-1'));
    expect(screen.getByTestId('welcome-entry-ledger-1')).toBeTruthy();
  });
});
