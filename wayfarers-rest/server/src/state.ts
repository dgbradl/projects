import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { WorldState } from '@shared/types';
import type { Clock } from './lib/clock.ts';
import type { Persistence } from './persistence.ts';

export type SeedFactory = () => string;

const defaultSeedFactory: SeedFactory = () =>
  randomBytes(8).toString('hex');

export class WorldStateManager extends EventEmitter {
  private state: WorldState;
  private wasColdStart: boolean;

  constructor(
    private readonly persistence: Persistence,
    private readonly clock: Clock,
    seedFactory: SeedFactory = defaultSeedFactory,
  ) {
    super();
    const existing = persistence.loadState();
    if (existing) {
      this.state = existing;
      this.wasColdStart = false;
    } else {
      const nowIso = new Date(clock.now()).toISOString();
      this.state = {
        gameDay: 1,
        lastTickAt: nowIso,
        status: 'running',
        unattendedTicks: 0,
        seed: seedFactory(),
        subTick: 0,
      };
      persistence.saveState(this.state);
      this.wasColdStart = true;
    }
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
