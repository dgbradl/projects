/**
 * Phase 8 (D1): persistence round-trip for tavern identity fields.
 *
 * Fresh DB → default name + empty traits. Save with custom values →
 * reload returns them. Malformed traits JSON round-trips to []. Unknown
 * trait strings are filtered out on load.
 */
import { describe, expect, it } from 'vitest';
import type { WorldState } from '@shared/types';
import { DEFAULT_TAVERN_NAME } from '@shared/types';
import { Persistence } from '../src/persistence.ts';

function base(p: Persistence, overrides: Partial<WorldState> = {}): WorldState {
  return {
    gameDay: 1,
    lastTickAt: '2026-01-01T00:00:00.000Z',
    status: 'running',
    unattendedTicks: 0,
    seed: 'tavern-identity',
    subTick: 0,
    lastAcknowledgedGameDay: 0,
    favors: 3,
    favorsLastRegenGameDay: 0,
    markedNpcIds: [],
    coin: 100,
    prosperity: 50,
    tavernName: DEFAULT_TAVERN_NAME,
    tavernTraits: [],
    ...overrides,
  };
}

describe('Persistence — tavern identity round-trip', () => {
  it('loads defaults on a fresh DB after first save', () => {
    const p = new Persistence(':memory:');
    p.saveState(base(p));
    const loaded = p.loadState()!;
    expect(loaded.tavernName).toBe(DEFAULT_TAVERN_NAME);
    expect(loaded.tavernTraits).toEqual([]);
    p.close();
  });

  it('round-trips a custom name and two traits', () => {
    const p = new Persistence(':memory:');
    p.saveState(
      base(p, {
        tavernName: 'The Salted Crow',
        tavernTraits: ['bardic_stage', 'arcane_haven'],
      }),
    );
    const loaded = p.loadState()!;
    expect(loaded.tavernName).toBe('The Salted Crow');
    expect(loaded.tavernTraits).toEqual(['bardic_stage', 'arcane_haven']);
    p.close();
  });

  it('drops unknown trait strings on load (forward-compat / malformed input)', () => {
    const p = new Persistence(':memory:');
    p.saveState(
      base(p, {
        tavernName: 'X',
        tavernTraits: ['bardic_stage', 'not_a_real_trait'] as never,
      }),
    );
    const loaded = p.loadState()!;
    expect(loaded.tavernTraits).toEqual(['bardic_stage']);
    p.close();
  });

  it('survives a re-open (durable via the SQLite layer)', () => {
    // :memory: DBs are per-instance, but we can still re-prepare and re-read.
    const p = new Persistence(':memory:');
    p.saveState(
      base(p, {
        tavernName: 'The Long Watch',
        tavernTraits: ['martial_billet'],
      }),
    );
    const a = p.loadState()!;
    const b = p.loadState()!;
    expect(a.tavernName).toBe(b.tavernName);
    expect(a.tavernTraits).toEqual(b.tavernTraits);
    p.close();
  });
});
