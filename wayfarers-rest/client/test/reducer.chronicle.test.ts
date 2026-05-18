import { describe, expect, it } from 'vitest';
import type {
  ChroniclesSinceResponse,
  DailyChronicle,
} from '@shared/types';
import { initialState, reducer } from '../src/state/reducer.ts';

function makeChronicle(day: number, overrides: Partial<DailyChronicle> = {}): DailyChronicle {
  return {
    gameDay: day,
    generatedAtRealTs: 'ts',
    status: 'complete',
    headlines: [`d${day} h1`, `d${day} h2`, `d${day} h3`],
    footnotes: [`d${day} f1`, `d${day} f2`, `d${day} f3`],
    modelUsed: 'stub',
    promptCharCount: 0,
    completionCharCount: 0,
    generationDurationMs: 0,
    failureReason: null,
    ...overrides,
  };
}

describe('chronicle reducer', () => {
  it('WELCOME_OPENED loads chronicles + pending days + prologue', () => {
    const payload: ChroniclesSinceResponse = {
      fromGameDay: 1,
      toGameDay: 5,
      chronicles: [makeChronicle(1), makeChronicle(2), makeChronicle(3)],
      pendingDays: [4, 5],
      prologue: {
        fromGameDay: 1,
        toGameDay: 5,
        text: 'A heavier week than the last one.',
        generatedAtRealTs: 'ts',
        status: 'complete',
      },
    };
    const next = reducer(initialState, { type: 'WELCOME_OPENED', payload });
    expect(next.welcome).not.toBeNull();
    expect(next.welcome!.show).toBe(true);
    expect(next.welcome!.chronicles[1]).toEqual(payload.chronicles[0]);
    expect(next.welcome!.chronicles[4]).toBe('pending');
    expect(next.welcome!.chronicles[5]).toBe('pending');
    expect(next.welcome!.prologue?.text).toContain('heavier week');
  });

  it('WELCOME_OPENED with empty range yields a welcome with show=false', () => {
    const payload: ChroniclesSinceResponse = {
      fromGameDay: 1,
      toGameDay: 0,
      chronicles: [],
      pendingDays: [],
      prologue: null,
    };
    const next = reducer(initialState, { type: 'WELCOME_OPENED', payload });
    expect(next.welcome!.show).toBe(false);
  });

  it('CHRONICLE_FILLED replaces a pending day with the real chronicle', () => {
    const opened = reducer(initialState, {
      type: 'WELCOME_OPENED',
      payload: {
        fromGameDay: 1,
        toGameDay: 2,
        chronicles: [makeChronicle(1)],
        pendingDays: [2],
        prologue: null,
      },
    });
    expect(opened.welcome!.chronicles[2]).toBe('pending');
    const after = reducer(opened, {
      type: 'CHRONICLE_FILLED',
      payload: makeChronicle(2, { status: 'fallback' }),
    });
    const filled = after.welcome!.chronicles[2];
    expect(filled).not.toBe('pending');
    expect((filled as DailyChronicle).status).toBe('fallback');
  });

  it('CHRONICLE_FILLED for a day outside the welcome range is a no-op', () => {
    const opened = reducer(initialState, {
      type: 'WELCOME_OPENED',
      payload: {
        fromGameDay: 1,
        toGameDay: 2,
        chronicles: [makeChronicle(1)],
        pendingDays: [2],
        prologue: null,
      },
    });
    const after = reducer(opened, {
      type: 'CHRONICLE_FILLED',
      payload: makeChronicle(99),
    });
    expect(after.welcome).toEqual(opened.welcome);
  });

  it('WELCOME_DISMISSED flips show to false', () => {
    const opened = reducer(initialState, {
      type: 'WELCOME_OPENED',
      payload: {
        fromGameDay: 1,
        toGameDay: 3,
        chronicles: [makeChronicle(1)],
        pendingDays: [2, 3],
        prologue: null,
      },
    });
    const after = reducer(opened, { type: 'WELCOME_DISMISSED' });
    expect(after.welcome!.show).toBe(false);
  });
});
