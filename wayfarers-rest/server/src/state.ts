import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { WorldState } from '@shared/types';
import { DEFAULT_TAVERN_NAME } from '@shared/types';
import { COIN_INITIAL_DEFAULT } from './economy/ledger.ts';
import { PROSPERITY_INITIAL } from './economy/prosperity.ts';
import type { Clock } from './lib/clock.ts';
import type { Persistence } from './persistence.ts';

export type SeedFactory = () => string;

const defaultSeedFactory: SeedFactory = () =>
  randomBytes(8).toString('hex');

export class WorldStateManager extends EventEmitter {
  private state: WorldState;
  private wasColdStart: boolean;
  private readonly seedFactory: SeedFactory;

  constructor(
    private readonly persistence: Persistence,
    private readonly clock: Clock,
    seedFactory: SeedFactory = defaultSeedFactory,
  ) {
    super();
    this.seedFactory = seedFactory;
    const existing = persistence.loadState();
    if (existing) {
      this.state = existing;
      this.wasColdStart = false;
    } else {
      this.state = this.freshState();
      persistence.saveState(this.state);
      this.wasColdStart = true;
    }
  }

  private freshState(): WorldState {
    const nowIso = new Date(this.clock.now()).toISOString();
    return {
      gameDay: 1,
      lastTickAt: nowIso,
      status: 'running',
      unattendedTicks: 0,
      seed: this.seedFactory(),
      subTick: 0,
      lastAcknowledgedGameDay: 0,
      favors: 3,
      favorsLastRegenGameDay: 0,
      markedNpcIds: [],
      coin: COIN_INITIAL_DEFAULT,
      prosperity: PROSPERITY_INITIAL,
      // Phase 8 (D1): tavern identity. The keeper hasn't named the place
      // yet — D2's onboarding modal flips both fields on first run.
      tavernName: DEFAULT_TAVERN_NAME,
      tavernTraits: [],
    };
  }

  /**
   * Replace the in-memory + persisted state with a brand-new fresh state.
   * Used by POST /control/reset after the persistence tables have been wiped.
   * Emits `state` so SSE subscribers see the new starting world.
   */
  reset(): WorldState {
    this.state = this.freshState();
    this.persistence.saveState(this.state);
    this.emit('state', this.getState());
    return this.getState();
  }

  getState(): WorldState {
    return { ...this.state };
  }

  setState(next: WorldState): WorldState {
    this.state = next;
    this.persistence.saveState(this.state);
    this.emit('state', this.getState());
    return this.getState();
  }

  isColdStart(): boolean {
    return this.wasColdStart;
  }
}
