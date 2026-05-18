import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import type { TickEvent, WorldState } from '@shared/types';
import type { Clock } from './lib/clock.ts';
import type { Persistence } from './persistence.ts';

export type SeedFactory = () => string;

const defaultSeedFactory: SeedFactory = () =>
  randomBytes(8).toString('hex');

export class WorldStateManager extends EventEmitter {
  private state: WorldState;

  constructor(
    private readonly persistence: Persistence,
    private readonly clock: Clock,
    seedFactory: SeedFactory = defaultSeedFactory,
  ) {
    super();
    const existing = persistence.loadState();
    if (existing) {
      this.state = existing;
    } else {
      const nowIso = new Date(clock.now()).toISOString();
      this.state = {
        gameDay: 1,
        lastTickAt: nowIso,
        status: 'running',
        unattendedTicks: 0,
        seed: seedFactory(),
      };
      persistence.saveState(this.state);
      persistence.appendEvent({
        gameDay: this.state.gameDay,
        realTimestamp: nowIso,
        type: 'init',
        payload: { seed: this.state.seed },
      });
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

  appendEvent(event: Omit<TickEvent, 'id'>): TickEvent {
    return this.persistence.appendEvent(event);
  }
}
