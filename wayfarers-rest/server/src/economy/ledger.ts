/**
 * Economy (E1): the daily ledger.
 *
 * Guest spend accrues as `guest_spent` events through the day. At each day
 * boundary `closeLedgerForDay` settles the day that just ended: it sums those
 * events, debits the tavern's upkeep, applies the net to the purse, and writes
 * one `daily_ledgers` row. Coin therefore moves once per day — the "day's
 * takings" — rather than coin-by-coin.
 */
import type { DailyLedger } from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';
import { rngInt, seededRng } from '../world/rng.ts';

/** The tavern's starting purse, in coin. */
export const COIN_INITIAL_DEFAULT = 200;

/** Fixed daily cost no matter how busy the tavern is (candles, firewood). */
const UPKEEP_BASE = 14;
/** Added cost per guest who passed through that day (food stock). */
const UPKEEP_PER_GUEST = 3;
/** Seeded jitter added to upkeep, drawn from [0, UPKEEP_JITTER]. */
const UPKEEP_JITTER = 6;

export interface ComputeUpkeepInput {
  worldSeed: string;
  gameDay: number;
  /** Guests who passed through that day — scales the variable cost. */
  occupancy: number;
}

/** Pure, deterministic daily upkeep cost. */
export function computeUpkeep(input: ComputeUpkeepInput): number {
  const rng = seededRng(input.worldSeed, 'upkeep', input.gameDay);
  const jitter = rngInt(rng, 0, UPKEEP_JITTER + 1);
  return UPKEEP_BASE + UPKEEP_PER_GUEST * Math.max(0, input.occupancy) + jitter;
}

export interface LedgerDeps {
  persistence: Persistence;
  stateManager: WorldStateManager;
  bus: WorldEventBus;
  worldSeed: string;
}

/**
 * Settle one game day's ledger. Sums that day's `guest_spent` events for
 * income, debits upkeep scaled by the day's arrivals, applies the net to the
 * purse, and records a `daily_ledgers` row.
 *
 * Idempotent: a day that already has a ledger row is a no-op. The row is
 * written before the coin `setState` so that, should the state listener
 * re-enter this function during that write, the second call bails cleanly.
 */
export function closeLedgerForDay(
  deps: LedgerDeps,
  closingGameDay: number,
): DailyLedger | null {
  if (closingGameDay < 1) return null;
  const existing = deps.persistence.loadDailyLedger(closingGameDay);
  if (existing) return existing;

  // Tally the day's settled tabs (income) and arrivals (occupancy) from the
  // event log — both are deterministic projections of a deterministic sim.
  let income = 0;
  let guestCount = 0;
  let occupancy = 0;
  for (const entry of deps.persistence.getEventsSince(0)) {
    const ev = entry.event;
    if (ev.gameDay !== closingGameDay) continue;
    if (ev.type === 'guest_spent') {
      income += ev.amount;
      guestCount += 1;
    } else if (ev.type === 'npc_arrived' || ev.type === 'npc_returned') {
      occupancy += 1;
    }
  }

  const expense = computeUpkeep({
    worldSeed: deps.worldSeed,
    gameDay: closingGameDay,
    occupancy,
  });
  const net = income - expense;
  const state = deps.stateManager.getState();
  const coinBefore = state.coin;
  // Soft economy: the purse can run dry but never goes negative.
  const coinAfter = Math.max(0, coinBefore + net);

  const ledger: DailyLedger = {
    gameDay: closingGameDay,
    income,
    expense,
    net,
    guestCount,
    coinAfter,
  };
  deps.persistence.upsertDailyLedger(ledger);
  deps.stateManager.setState({ ...state, coin: coinAfter });

  deps.bus.publish({
    type: 'tavern_upkeep',
    gameDay: closingGameDay,
    amount: expense,
    occupancy,
  });
  deps.bus.publish({
    type: 'ledger_closed',
    gameDay: closingGameDay,
    income,
    expense,
    net,
    coinBefore,
    coinAfter,
    guestCount,
  });
  return ledger;
}
