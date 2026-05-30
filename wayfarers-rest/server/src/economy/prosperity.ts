/**
 * Economy (E2): tavern prosperity.
 *
 * Prosperity is a rolling 0-100 score derived from how the tavern has been
 * doing — its profit, how full it has been, and how warmly guests treated
 * each other. It is settled once per day, right after the ledger, and feeds
 * back into arrivals and favor regeneration (see index.ts / spawn.ts), so a
 * thriving tavern draws a fuller, better house and a struggling one thins
 * out — without ever bottoming out (a soft modifier, never a fail state).
 */
import type { ProsperityTier } from '@shared/types';
import { tierForScore } from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';

/** The tavern opens at a mid-range "steady" standing. */
export const PROSPERITY_INITIAL = 50;

/** Days of recent history the rolling score considers. */
const WINDOW_DAYS = 5;
/** How sharply the score chases recent quality (0..1); higher = snappier. */
const SMOOTHING = 0.25;

export interface ProsperityInput {
  previousScore: number;
  /** Sum of DailyLedger.net across the window. */
  windowNet: number;
  /** Sum of guests served across the window. */
  windowGuests: number;
  /** Friendly interactions minus arguments across the window. */
  windowSocial: number;
  /** Days the window actually spans (>= 1). */
  windowDays: number;
}

export interface ProsperityResult {
  score: number;
  tier: ProsperityTier;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Pure, deterministic prosperity update. Blends three daily-average signals —
 * profit, occupancy, guest warmth — into a 0..100 "day quality", then eases
 * the previous score a quarter of the way toward it. The smoothing keeps the
 * tier from flickering from one day to the next.
 */
export function computeProsperity(input: ProsperityInput): ProsperityResult {
  const days = Math.max(1, input.windowDays);
  const avgNet = input.windowNet / days;
  const avgGuests = input.windowGuests / days;
  const avgSocial = input.windowSocial / days;

  // Each signal maps onto 0..100.
  const profit = clamp(((avgNet + 50) / 150) * 100, 0, 100);
  const occupancy = clamp((avgGuests / 8) * 100, 0, 100);
  const social = clamp(((avgSocial + 2) / 8) * 100, 0, 100);

  const dayQuality = profit * 0.5 + occupancy * 0.3 + social * 0.2;
  const score = clamp(
    input.previousScore + (dayQuality - input.previousScore) * SMOOTHING,
    0,
    100,
  );
  return { score, tier: tierForScore(score) };
}

export interface ProsperityDeps {
  persistence: Persistence;
  stateManager: WorldStateManager;
  bus: WorldEventBus;
}

/**
 * Settle a game day's prosperity. The previous day's score is read from its
 * `daily_ledgers` row (immutable once written), so re-running for the same
 * day reproduces the identical result and is a safe no-op — which matters
 * because the day-change state listener can re-enter this path.
 */
export function updateProsperityForDay(
  deps: ProsperityDeps,
  closingGameDay: number,
): ProsperityResult | null {
  if (closingGameDay < 1) return null;
  const today = deps.persistence.loadDailyLedger(closingGameDay);
  if (!today) return null;
  if (today.prosperityAfter != null) {
    return {
      score: today.prosperityAfter,
      tier: tierForScore(today.prosperityAfter),
    };
  }

  const prevLedger = deps.persistence.loadDailyLedger(closingGameDay - 1);
  const previousScore = prevLedger?.prosperityAfter ?? PROSPERITY_INITIAL;

  const fromDay = Math.max(1, closingGameDay - WINDOW_DAYS + 1);
  let windowNet = 0;
  let windowGuests = 0;
  for (const l of deps.persistence.loadDailyLedgersBetween(fromDay, closingGameDay)) {
    windowNet += l.net;
    windowGuests += l.guestCount;
  }

  // Guest warmth: shared drinks lift it, overheard arguments drag it down.
  // Phase 8 (A5): unfulfilled desires also pull warmth down — a guest who
  // left wanting carries a faint sourness with them. Weight 0.5 each so two
  // unfulfilled desires roughly equal one argument; the smoothing in
  // computeProsperity tempers the daily impact further.
  // Phase 9 (F5): stage event resolutions fold in too. A wedding warms the
  // place; a brawl that burned out sours it; a brawl the keeper defused
  // is neutral (their hand cancels the damage). Court days and storyteller
  // circles register but lightly — they're texture more than impact.
  let windowSocial = 0;
  for (const entry of deps.persistence.getEventsSince(0)) {
    const ev = entry.event;
    if (ev.gameDay < fromDay || ev.gameDay > closingGameDay) continue;
    if (ev.type === 'interaction') {
      if (ev.interaction.kind === 'shared_drink') windowSocial += 1;
      else if (ev.interaction.kind === 'overheard_argument') windowSocial -= 1;
    } else if (ev.type === 'desire_unfulfilled') {
      windowSocial -= 0.5;
    } else if (ev.type === 'stage_event_resolved') {
      windowSocial += stageEventSocialWeight(ev.stageEventType, ev.outcome);
    }
  }

  const result = computeProsperity({
    previousScore,
    windowNet,
    windowGuests,
    windowSocial,
    windowDays: closingGameDay - fromDay + 1,
  });

  deps.persistence.upsertDailyLedger({
    ...today,
    prosperityAfter: result.score,
  });
  const state = deps.stateManager.getState();
  deps.stateManager.setState({ ...state, prosperity: result.score });

  const previousTier = tierForScore(previousScore);
  if (previousTier !== result.tier) {
    deps.bus.publish({
      type: 'prosperity_changed',
      gameDay: closingGameDay,
      score: result.score,
      tier: result.tier,
      previousTier,
    });
  }
  return result;
}

/**
 * Phase 9 (F5): per-scene-outcome contribution to the windowSocial signal.
 * Tuned so:
 *   - Weddings clearly lift the room (warmth + celebration)
 *   - Brawls that burn out clearly hurt (chaos + unmet bills)
 *   - A keeper-defused scene is neutral (their action cancels the damage)
 *   - Storyteller circles add a small lift (texture without dominating)
 *   - Court days are a wash (just business)
 * Smoothing in computeProsperity keeps any single day's impact bounded.
 */
function stageEventSocialWeight(
  type: 'brawl' | 'wedding' | 'court_day' | 'storyteller_circle',
  outcome: 'burned_out' | 'defused_by_keeper' | 'broken_up' | 'completed',
): number {
  if (outcome === 'defused_by_keeper') return 0;
  switch (type) {
    case 'wedding':
      return 3;
    case 'storyteller_circle':
      return 1;
    case 'court_day':
      return 0;
    case 'brawl':
      return outcome === 'burned_out' ? -3 : outcome === 'broken_up' ? -1 : 0;
  }
}
