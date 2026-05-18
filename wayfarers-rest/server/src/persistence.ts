import Database from 'better-sqlite3';
import type { TickEvent, WorldState } from '@shared/types';

interface WorldStateRow {
  id: number;
  game_day: number;
  last_tick_at: string;
  status: string;
  unattended_ticks: number;
  seed: string;
}

interface TickEventRow {
  id: number;
  game_day: number;
  real_timestamp: string;
  type: string;
  payload: string;
}

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
        seed TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tick_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_day INTEGER NOT NULL,
        real_timestamp TEXT NOT NULL,
        type TEXT NOT NULL,
        payload TEXT NOT NULL
      );
    `);
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
    };
  }

  saveState(state: WorldState): void {
    this.db
      .prepare(
        `INSERT INTO world_state (id, game_day, last_tick_at, status, unattended_ticks, seed)
         VALUES (1, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           game_day = excluded.game_day,
           last_tick_at = excluded.last_tick_at,
           status = excluded.status,
           unattended_ticks = excluded.unattended_ticks,
           seed = excluded.seed`,
      )
      .run(
        state.gameDay,
        state.lastTickAt,
        state.status,
        state.unattendedTicks,
        state.seed,
      );
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
