import { EventEmitter } from 'node:events';
import type { FlavorPoolStatus } from '@shared/types';
import type { WorldEventBus } from '../../events/emitter.ts';
import type { Persistence } from '../../persistence.ts';
import type { FlavorModeManager } from '../mode.ts';
import { Pool, poolKey, type PoolConfig } from './pool.ts';

export interface PlaceholderProvider<TInput, TItem> {
  placeholder(input: TInput): TItem;
}

export interface TakeOpts<TInput> {
  subKey?: string;
  placeholderInput: TInput;
  /** Game day passed into emit() if a cache miss is recorded. */
  gameDay?: number;
}

interface PersistedItemRef<T> {
  dbId: number;
  item: T;
}

/**
 * Holds all pools, mirrors them to SQLite, and exposes a synchronous `take`
 * that falls back to placeholder content when the pool is empty (or when the
 * current flavor mode says so).
 */
export class FlavorCache extends EventEmitter {
  private pools = new Map<string, Pool<unknown>>();
  /** Tracks DB ids in parallel with pool.items so we can DELETE on take. */
  private dbIds = new Map<string, number[]>();
  /** Per-pool placeholder provider. */
  private placeholders = new Map<string, PlaceholderProvider<unknown, unknown>>();

  constructor(
    private readonly persistence: Persistence,
    private readonly bus: WorldEventBus,
    private readonly mode: FlavorModeManager,
  ) {
    super();
  }

  registerPool<TInput, TItem>(
    config: PoolConfig<TItem>,
    placeholder: PlaceholderProvider<TInput, TItem>,
  ): void {
    const key = poolKey(config.kind, config.subKey);
    this.pools.set(key, new Pool(config));
    this.dbIds.set(key, []);
    this.placeholders.set(
      key,
      placeholder as PlaceholderProvider<unknown, unknown>,
    );
  }

  /**
   * Load all pool contents from SQLite. Items whose pool was never registered
   * remain unused — they're not deleted, in case future archetypes show up.
   */
  rehydrate(): void {
    const rows = this.persistence.loadFlavorCacheItems();
    for (const row of rows) {
      const key = poolKey(row.kind, row.subKey);
      const pool = this.pools.get(key);
      const ids = this.dbIds.get(key);
      if (!pool || !ids) continue;
      try {
        pool.items.push(JSON.parse(row.contentJson));
        ids.push(row.id);
      } catch {
        // skip malformed rows
      }
    }
  }

  /**
   * Synchronously pop a content item. Behaviour:
   *  - mode === 'placeholder' → always uses the placeholder.
   *  - cache empty → emit flavor_cache_miss, fall back to placeholder.
   *  - otherwise pop from the pool and delete its DB row.
   * In all non-placeholder modes, also enqueue a refill if the pool is now
   * below threshold (purely a signal to the worker; this method does not
   * generate).
   */
  take<TInput, TItem>(kind: string, opts: TakeOpts<TInput>): TItem {
    const subKey = opts.subKey ?? '';
    const key = poolKey(kind, subKey);
    const provider = this.placeholders.get(key) as
      | PlaceholderProvider<TInput, TItem>
      | undefined;
    const pool = this.pools.get(key) as Pool<TItem> | undefined;
    if (!provider || !pool) {
      throw new Error(`FlavorCache: no pool registered for ${key}`);
    }

    if (this.mode.getMode() === 'placeholder') {
      return provider.placeholder(opts.placeholderInput);
    }

    const item = pool.take();
    if (item === undefined) {
      this.bus.publish({
        type: 'flavor_cache_miss',
        gameDay: opts.gameDay ?? 0,
        slot: kind,
        subKey: subKey || undefined,
      });
      this.emit('miss', { kind, subKey });
      return provider.placeholder(opts.placeholderInput);
    }

    const ids = this.dbIds.get(key)!;
    const dbId = ids.shift();
    if (dbId !== undefined) {
      this.persistence.deleteFlavorCacheItem(dbId);
    }
    return item;
  }

  /**
   * Push items into a pool (worker side). Persists each.
   */
  push<T>(kind: string, subKey: string, item: T | T[]): void {
    const key = poolKey(kind, subKey);
    const pool = this.pools.get(key) as Pool<T> | undefined;
    if (!pool) throw new Error(`FlavorCache: no pool registered for ${key}`);
    const arr = pool.push(item);
    const ids = this.dbIds.get(key)!;
    const ts = new Date().toISOString();
    for (const it of arr) {
      const dbId = this.persistence.insertFlavorCacheItem(
        kind,
        subKey,
        JSON.stringify(it),
        ts,
      );
      ids.push(dbId);
    }
  }

  getPool<T>(kind: string, subKey?: string): Pool<T> | undefined {
    return this.pools.get(poolKey(kind, subKey)) as Pool<T> | undefined;
  }

  getAllPools(): Pool<unknown>[] {
    return [...this.pools.values()];
  }

  getStatus(): FlavorPoolStatus[] {
    return [...this.pools.values()].map((p) => p.status());
  }
}
