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
export const COIN_INITIAL_DEFAULT = 300;

/**
 * Fixed daily cost no matter how busy the tavern is (candles, firewood).
 * Tuned 2026-05-23 from 14 → 8: real-game traffic is bursty, and quiet days
 * shouldn't drain the purse faster than a single guest can refill it.
 */
const UPKEEP_BASE = 8;
/** Added cost per guest who passed through that day (food stock). */
const UPKEEP_PER_GUEST = 2;
/** Seeded jitter added to upkeep, drawn from [0, UPKEEP_JITTER]. */
const UPKEEP_JITTER = 6;

/**
 * Economy (E3): the larder loses one stock level each day the tavern is open
 * — the day's meals draw it down. The keeper offsets this with the
 * `restock_larder` intervention; left alone, a full larder lasts five days.
 */
export const LARDER_DECAY_PER_DAY = 1;

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

/**
 * Economy (E3): debit coin for a deliberate keeper purchase. Throws if the
 * purse can't cover it — a price check on a chosen action, not the autonomous
 * soft economy (which never goes negative on its own).
 */
export function debitCoin(
  stateManager: WorldStateManager,
  cost: number,
): void {
  const state = stateManager.getState();
  if (state.coin < cost) {
    throw new Error(`not enough coin: have ${state.coin}, need ${cost}`);
  }
  stateManager.setState({ ...state, coin: state.coin - cost });
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
 * purse, records a `daily_ledgers` row, and depletes the larder by one level
 * (Economy E3).
 *
 * Idempotent: a day that already has a ledger row is a no-op. The row is
 * written before the coin `setState` so that, should the state listener
 * re-enter this function during that write, the second call bails cleanly —
 * which is also what keeps the larder from decaying twice for one day.
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
    } else if (ev.type === 'staff_service_income') {
      income += ev.amount;
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
  // Economy (E3): the day's meals draw the larder down by one level.
  const larderAfter = Math.max(
    0,
    (state.larderStock ?? 0) - LARDER_DECAY_PER_DAY,
  );
  deps.persistence.upsertDailyLedger(ledger);
  deps.stateManager.setState({
    ...state,
    coin: coinAfter,
    larderStock: larderAfter,
  });

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
