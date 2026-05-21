import { describe, expect, it } from 'vitest';
import { tierForScore } from '@shared/types';
import {
  computeProsperity,
  PROSPERITY_INITIAL,
  updateProsperityForDay,
} from '../src/economy/prosperity.ts';
import { WorldEventBus } from '../src/events/emitter.ts';
import { FakeClock } from '../src/lib/clock.ts';
import { Persistence } from '../src/persistence.ts';
import { generateSpawnQueue } from '../src/npc/spawn.ts';
import { WorldStateManager } from '../src/state.ts';

describe('tierForScore', () => {
  it('maps scores to tiers at the boundaries', () => {
    expect(tierForScore(0)).toBe('struggling');
    expect(tierForScore(24.9)).toBe('struggling');
    expect(tierForScore(25)).toBe('steady');
    expect(tierForScore(54.9)).toBe('steady');
    expect(tierForScore(55)).toBe('thriving');
    expect(tierForScore(79.9)).toBe('thriving');
    expect(tierForScore(80)).toBe('renowned');
    expect(tierForScore(100)).toBe('renowned');
  });
});

const BASE = {
  previousScore: 50,
  windowNet: 0,
  windowGuests: 0,
  windowSocial: 0,
  windowDays: 1,
};

describe('computeProsperity', () => {
  it('is pure and deterministic', () => {
    expect(computeProsperity(BASE)).toEqual(computeProsperity({ ...BASE }));
  });

  it('keeps the score within [0, 100] for any inputs', () => {
    for (const net of [-99999, -200, 0, 200, 99999]) {
      for (const prev of [0, 50, 100]) {
        const r = computeProsperity({
          previousScore: prev,
          windowNet: net,
          windowGuests: 80,
          windowSocial: -40,
          windowDays: 5,
        });
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it('a profitable, busy, friendly tavern lifts the score', () => {
    const good = computeProsperity({
      previousScore: 50,
      windowNet: 400,
      windowGuests: 40,
      windowSocial: 30,
      windowDays: 5,
    });
    expect(good.score).toBeGreaterThan(50);
  });

  it('a losing, empty, quarrelsome tavern drags the score down', () => {
    const bad = computeProsperity({
      previousScore: 50,
      windowNet: -250,
      windowGuests: 0,
      windowSocial: -10,
      windowDays: 5,
    });
    expect(bad.score).toBeLessThan(50);
  });

  it('eases toward day quality rather than jumping (smoothing)', () => {
    const r = computeProsperity({
      previousScore: 10,
      windowNet: 900,
      windowGuests: 60,
      windowSocial: 40,
      windowDays: 5,
    });
    expect(r.score).toBeGreaterThan(10);
    expect(r.score).toBeLessThan(90); // a single great day is not an instant leap
  });
});

function setup(seed = 'prosp-seed') {
  const persistence = new Persistence(':memory:');
  const clock = new FakeClock(Date.parse('2026-01-01T00:00:00.000Z'));
  const stateManager = new WorldStateManager(persistence, clock, () => seed);
  const bus = new WorldEventBus(persistence, clock);
  return { persistence, stateManager, bus, deps: { persistence, stateManager, bus } };
}

describe('updateProsperityForDay', () => {
  it('returns null before there is a ledger for the day', () => {
    const { deps } = setup();
    expect(updateProsperityForDay(deps, 0)).toBeNull();
    expect(updateProsperityForDay(deps, 5)).toBeNull();
  });

  it("settles prosperity from the day's ledger and persists it", () => {
    const { persistence, stateManager, deps } = setup();
    persistence.upsertDailyLedger({
      gameDay: 1,
      income: 120,
      expense: 30,
      net: 90,
      guestCount: 8,
      coinAfter: 290,
    });
    const result = updateProsperityForDay(deps, 1);
    expect(result).not.toBeNull();
    expect(stateManager.getState().prosperity).toBe(result!.score);
    expect(persistence.loadDailyLedger(1)?.prosperityAfter).toBe(result!.score);
    expect(result!.score).toBeGreaterThan(PROSPERITY_INITIAL);
  });

  it('is idempotent — re-running a day reproduces the score, no second event', () => {
    const { persistence, deps } = setup();
    persistence.upsertDailyLedger({
      gameDay: 1,
      income: 120,
      expense: 30,
      net: 90,
      guestCount: 8,
      coinAfter: 290,
    });
    const first = updateProsperityForDay(deps, 1);
    const second = updateProsperityForDay(deps, 1);
    expect(second).toEqual(first);
    const changes = persistence
      .getEventsSince(0)
      .filter((e) => e.event.type === 'prosperity_changed');
    expect(changes.length).toBeLessThanOrEqual(1);
  });

  it('emits prosperity_changed when the tier shifts', () => {
    const { persistence, deps } = setup();
    persistence.upsertDailyLedger({
      gameDay: 1,
      income: 200,
      expense: 20,
      net: 180,
      guestCount: 10,
      coinAfter: 380,
    });
    const result = updateProsperityForDay(deps, 1);
    const changed = persistence
      .getEventsSince(0)
      .find((e) => e.event.type === 'prosperity_changed');
    expect(changed).toBeDefined();
    if (changed && changed.event.type === 'prosperity_changed') {
      expect(changed.event.previousTier).toBe('steady');
      expect(changed.event.tier).toBe(result!.tier);
    }
  });
});

describe('prosperity feedback — arrivals', () => {
  it('a thriving tavern draws a fuller house than a struggling one', () => {
    const cfg = { worldSeed: 'spawn-p', gameDay: 3, subTicksPerDay: 360 };
    const struggling = generateSpawnQueue({ ...cfg, prosperityTier: 'struggling' });
    const steady = generateSpawnQueue({ ...cfg, prosperityTier: 'steady' });
    const renowned = generateSpawnQueue({ ...cfg, prosperityTier: 'renowned' });
    expect(renowned.length).toBeGreaterThan(steady.length);
    expect(steady.length).toBeGreaterThan(struggling.length);
  });

  it('never empties the tavern, even through a long struggle', () => {
    for (let day = 1; day <= 40; day += 1) {
      const q = generateSpawnQueue({
        worldSeed: 'lean',
        gameDay: day,
        subTicksPerDay: 360,
        prosperityTier: 'struggling',
      });
      expect(q.length).toBeGreaterThan(0);
    }
  });

  it('omitting prosperityTier matches steady — existing callers are unchanged', () => {
    const cfg = { worldSeed: 'spawn-p', gameDay: 7, subTicksPerDay: 360 };
    expect(generateSpawnQueue(cfg)).toEqual(
      generateSpawnQueue({ ...cfg, prosperityTier: 'steady' }),
    );
  });
});
