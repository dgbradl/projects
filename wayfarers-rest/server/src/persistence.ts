import Database from 'better-sqlite3';
import type { TickEvent, WorldState } from '@shared/types';
import type { RosterSnapshot } from './npc/manager.ts';

interface WorldStateRow {
  id: number;
  game_day: number;
  last_tick_at: string;
  status: string;
  unattended_ticks: number;
  seed: string;
  sub_tick: number;
  roster: string;
}

interface TickEventRow {
  id: number;
  game_day: number;
  real_timestamp: string;
  type: string;
  payload: string;
}

const DEFAULT_ROSTER_JSON = '{"npcs":[],"spawnQueue":[]}';

export class Persistence {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS world_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        game_day INTEGER NOT NULL,
        last_tick_at TEXT NOT NULL,
        status TEXT NOT NULL,
        unattended_ticks INTEGER NOT NULL,
        seed TEXT NOT NULL,
        sub_tick INTEGER NOT NULL DEFAULT 0,
        roster TEXT NOT NULL DEFAULT '${DEFAULT_ROSTER_JSON}'
      );

      CREATE TABLE IF NOT EXISTS tick_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_day INTEGER NOT NULL,
        real_timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);

    // Phase-2 column adds for Phase-1 DBs. SQLite has no `IF NOT EXISTS` on
    // ALTER TABLE — swallow the duplicate-column error.
    this.addColumnIfMissing('world_state', 'sub_tick', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumnIfMissing(
      'world_state',
      'roster',
      `TEXT NOT NULL DEFAULT '${DEFAULT_ROSTER_JSON}'`,
    );
  }

  private addColumnIfMissing(table: string, column: string, decl: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{
      name: string;
    }>;
    if (cols.some((c) => c.name === column)) return;
    this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`);
  }

  loadState(): WorldState | null {
    const row = this.db
      .prepare('SELECT * FROM world_state WHERE id = 1')
      .get() as WorldStateRow | undefined;
    if (!row) return null;
    if (row.status !== 'running' && row.status !== 'paused') {
      throw new Error(`Invalid status in DB: ${row.status}`);
    }
    return {
      gameDay: row.game_day,
      lastTickAt: row.last_tick_at,
      status: row.status,
      unattendedTicks: row.unattended_ticks,
      seed: row.seed,
      subTick: row.sub_tick,
    };
  }

  saveState(state: WorldState): void {
    this.db
      .prepare(
        `INSERT INTO world_state (id, game_day, last_tick_at, status, unattended_ticks, seed, sub_tick)
         VALUES (1, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           game_day = excluded.game_day,
           last_tick_at = excluded.last_tick_at,
           status = excluded.status,
           unattended_ticks = excluded.unattended_ticks,
           seed = excluded.seed,
           sub_tick = excluded.sub_tick`,
      )
      .run(
        state.gameDay,
        state.lastTickAt,
        state.status,
        state.unattendedTicks,
        state.seed,
        state.subTick,
      );
  }

  loadRoster(): RosterSnapshot {
    const row = this.db
      .prepare('SELECT roster FROM world_state WHERE id = 1')
      .get() as { roster: string } | undefined;
    if (!row) return { npcs: [], spawnQueue: [] };
    try {
      const parsed = JSON.parse(row.roster) as RosterSnapshot;
      return {
        npcs: Array.isArray(parsed.npcs) ? parsed.npcs : [],
        spawnQueue: Array.isArray(parsed.spawnQueue) ? parsed.spawnQueue : [],
      };
    } catch {
      return { npcs: [], spawnQueue: [] };
    }
  }

  saveRoster(snapshot: RosterSnapshot): void {
    this.db
      .prepare('UPDATE world_state SET roster = ? WHERE id = 1')
      .run(JSON.stringify(snapshot));
  }

  appendEvent(event: Omit<TickEvent, 'id'>): TickEvent {
    const result = this.db
      .prepare(
        `INSERT INTO tick_events (game_day, real_timestamp, type, payload)
         VALUES (?, ?, ?, ?)`,
      )
      .run(
        event.gameDay,
        event.realTimestamp,
        event.type,
        JSON.stringify(event.payload),
      );
    return { id: Number(result.lastInsertRowid), ...event };
  }

  getEventsSince(sinceId: number): TickEvent[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM tick_events WHERE id > ? ORDER BY id ASC',
      )
      .all(sinceId) as TickEventRow[];
    return rows.map((r) => ({
      id: r.id,
      gameDay: r.game_day,
      realTimestamp: r.real_timestamp,
      type: r.type as TickEvent['type'],
      payload: JSON.parse(r.payload) as Record<string, unknown>,
    }));
  }

  close(): void {
    this.db.close();
  }
}
