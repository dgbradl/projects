import type { FlavorPoolStatus } from '@shared/types';

export interface PoolConfig<T> {
  kind: string;
  subKey: string;
  targetSize: number;
  refillThreshold: number;
  /** Returns one or many items per call. */
  generate: () => Promise<T | T[]>;
}

/**
 * A single in-memory pool. Persistence is mirrored externally by `FlavorCache`.
 */
export class Pool<T> {
  readonly items: T[] = [];
  recentFailures = 0;
  /** Worker skips this pool until this many additional worker ticks elapse. */
  backoffSkipsRemaining = 0;
  lastRefillAt?: string;

  constructor(public readonly config: PoolConfig<T>) {}

  size(): number {
    return this.items.length;
  }

  needsRefill(): boolean {
    return this.items.length < this.config.refillThreshold;
  }

  deficit(): number {
    return Math.max(0, this.config.targetSize - this.items.length);
  }

  take(): T | undefined {
    return this.items.shift();
  }

  push(item: T | T[]): T[] {
    const arr = Array.isArray(item) ? item : [item];
    this.items.push(...arr);
    this.lastRefillAt = new Date().toISOString();
    this.recentFailures = 0;
    return arr;
  }

  recordFailure(skipFor: number): void {
    this.recentFailures += 1;
    this.backoffSkipsRemaining = skipFor;
  }

  tickBackoff(): void {
    if (this.backoffSkipsRemaining > 0) this.backoffSkipsRemaining -= 1;
  }

  status(): FlavorPoolStatus {
    return {
      kind: this.config.kind,
      subKey: this.config.subKey,
      size: this.items.length,
      target: this.config.targetSize,
      refillThreshold: this.config.refillThreshold,
      lastRefillAt: this.lastRefillAt,
      recentFailures: this.recentFailures,
    };
  }
}

export function poolKey(kind: string, subKey?: string): string {
  return `${kind}|${subKey ?? ''}`;
}
