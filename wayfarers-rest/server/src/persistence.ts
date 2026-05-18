import Database from 'better-sqlite3';
import type {
  EventLogEntry,
  Rumor,
  ScheduledArrival,
  Thread,
  TickEvent,
  WorldEvent,
  WorldState,
  WorldTag,
} from '@shared/types';
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

interface EventRow {
  id: number;
  real_timestamp: string;
  event_json: string;
}

interface ThreadRow {
  id: string;
  type: string;
  status: string;
  state: string;
  started_game_day: number;
  next_tick_game_day: number;
  payload: string;
  history: string;
}

interface WorldTagRow {
  key: string;
  value: string;
  set_on_game_day: number;
}

interface RumorRow {
  id: string;
  text: string;
  introduced_game_day: number;
  source_thread_id: string | null;
  available: number;
  origin_location_id: string | null;
}

interface ScheduledArrivalRow {
  npc_id: string;
  display_name: string;
  scheduled_game_day: number;
  scheduled_sub_tick: number;
  archetype: string | null;
  origin_location_id: string | null;
  carried_rumor_ids: string | null;
}

const DEFAULT_ROSTER_JSON = '{"npcs":[],"spawnQueue":[]}';

export class Persistence {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initSchema();
    this.migratePhase3();
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

      CREATE TABLE IF NOT EXISTS schema_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        real_timestamp TEXT NOT NULL,
        event_json TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        state TEXT NOT NULL,
        started_game_day INTEGER NOT NULL,
        next_tick_game_day INTEGER NOT NULL,
        payload TEXT NOT NULL,
        history TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS world_tags (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        set_on_game_day INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS rumors (
        id TEXT PRIMARY KEY,
        text TEXT NOT NULL,
        introduced_game_day INTEGER NOT NULL,
        source_thread_id TEXT,
        available INTEGER NOT NULL,
        origin_location_id TEXT
      );

      CREATE TABLE IF NOT EXISTS scheduled_arrivals (
        npc_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        scheduled_game_day INTEGER NOT NULL,
        scheduled_sub_tick INTEGER NOT NULL,
        archetype TEXT,
        origin_location_id TEXT,
        carried_rumor_ids TEXT
      );
    `);

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

  /**
   * Idempotent migration: copy any Phase 1 tick_events rows into the new
   * events table as typed WorldEvents, keyed by a schema_meta flag.
   */
  private migratePhase3(): void {
    const done = this.db
      .prepare('SELECT value FROM schema_meta WHERE key = ?')
      .get('phase3_events_migrated') as { value: string } | undefined;
    if (done) return;

    const legacy = this.db
      .prepare(
        'SELECT id, game_day, real_timestamp, type FROM tick_events ORDER BY id ASC',
      )
      .all() as Array<{
      id: number;
      game_day: number;
      real_timestamp: string;
      type: string;
    }>;

    const insert = this.db.prepare(
      'INSERT INTO events (real_timestamp, event_json) VALUES (?, ?)',
    );
    const tx = this.db.transaction(
      (rows: typeof legacy) => {
        for (const row of rows) {
          if (
            row.type !== 'init' &&
            row.type !== 'tick' &&
            row.type !== 'pause' &&
            row.type !== 'resume'
          ) {
            continue;
          }
          const event: WorldEvent = {
            type: row.type,
            gameDay: row.game_day,
          };
          insert.run(row.real_timestamp, JSON.stringify(event));
        }
        this.db
          .prepare('INSERT INTO schema_meta (key, value) VALUES (?, ?)')
          .run('phase3_events_migrated', new Date().toISOString());
      },
    );
    tx(legacy);
  }

  // ---------- world_state ----------

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

  // ---------- events ----------

  appendWorldEvent(event: WorldEvent, realTimestamp: string): EventLogEntry {
    const result = this.db
      .prepare('INSERT INTO events (real_timestamp, event_json) VALUES (?, ?)')
      .run(realTimestamp, JSON.stringify(event));
    return { id: Number(result.lastInsertRowid), realTimestamp, event };
  }

  getEventsSince(sinceId: number): EventLogEntry[] {
    const rows = this.db
      .prepare(
        'SELECT id, real_timestamp, event_json FROM events WHERE id > ? ORDER BY id ASC',
      )
      .all(sinceId) as EventRow[];
    return rows.map((r) => ({
      id: r.id,
      realTimestamp: r.real_timestamp,
      event: JSON.parse(r.event_json) as WorldEvent,
    }));
  }

  /** @deprecated Used only by migration tests. */
  appendLegacyTickEvent(event: Omit<TickEvent, 'id'>): TickEvent {
    const result = this.db
      .prepare(
        'INSERT INTO tick_events (game_day, real_timestamp, type, payload) VALUES (?, ?, ?, ?)',
      )
      .run(
        event.gameDay,
        event.realTimestamp,
        event.type,
        JSON.stringify(event.payload),
      );
    return { id: Number(result.lastInsertRowid), ...event };
  }

  // ---------- threads ----------

  saveThread(thread: Thread): void {
    this.db
      .prepare(
        `INSERT INTO threads (id, type, status, state, started_game_day, next_tick_game_day, payload, history)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           status = excluded.status,
           state = excluded.state,
           started_game_day = excluded.started_game_day,
           next_tick_game_day = excluded.next_tick_game_day,
           payload = excluded.payload,
           history = excluded.history`,
      )
      .run(
        thread.id,
        thread.type,
        thread.status,
        thread.state,
        thread.startedGameDay,
        thread.nextTickGameDay,
        JSON.stringify(thread.payload),
        JSON.stringify(thread.history),
      );
  }

  loadActiveThreadsDueBy(gameDay: number): Thread[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM threads
         WHERE status = 'active' AND next_tick_game_day <= ?
         ORDER BY next_tick_game_day ASC, id ASC`,
      )
      .all(gameDay) as ThreadRow[];
    return rows.map(this.rowToThread);
  }

  loadAllThreads(): Thread[] {
    const rows = this.db
      .prepare('SELECT * FROM threads ORDER BY started_game_day ASC, id ASC')
      .all() as ThreadRow[];
    return rows.map(this.rowToThread);
  }

  loadActiveThreads(): Thread[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM threads WHERE status = 'active' ORDER BY next_tick_game_day ASC, id ASC",
      )
      .all() as ThreadRow[];
    return rows.map(this.rowToThread);
  }

  countThreadsStartedOnDay(type: string, gameDay: number): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM threads WHERE type = ? AND started_game_day = ?',
      )
      .get(type, gameDay) as { n: number };
    return row.n;
  }

  private rowToThread = (row: ThreadRow): Thread => ({
    id: row.id,
    type: row.type,
    status: row.status as Thread['status'],
    state: row.state,
    startedGameDay: row.started_game_day,
    nextTickGameDay: row.next_tick_game_day,
    payload: JSON.parse(row.payload),
    history: JSON.parse(row.history),
  });

  // ---------- world_tags ----------

  getWorldTag(key: string): WorldTag | null {
    const row = this.db
      .prepare('SELECT * FROM world_tags WHERE key = ?')
      .get(key) as WorldTagRow | undefined;
    if (!row) return null;
    return { key: row.key, value: row.value, setOnGameDay: row.set_on_game_day };
  }

  getAllWorldTags(): WorldTag[] {
    const rows = this.db
      .prepare('SELECT * FROM world_tags ORDER BY key ASC')
      .all() as WorldTagRow[];
    return rows.map((r) => ({
      key: r.key,
      value: r.value,
      setOnGameDay: r.set_on_game_day,
    }));
  }

  saveWorldTag(tag: WorldTag): void {
    this.db
      .prepare(
        `INSERT INTO world_tags (key, value, set_on_game_day) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, set_on_game_day = excluded.set_on_game_day`,
      )
      .run(tag.key, tag.value, tag.setOnGameDay);
  }

  // ---------- rumors ----------

  saveRumor(rumor: Rumor): void {
    this.db
      .prepare(
        `INSERT INTO rumors (id, text, introduced_game_day, source_thread_id, available, origin_location_id)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           introduced_game_day = excluded.introduced_game_day,
           source_thread_id = excluded.source_thread_id,
           available = excluded.available,
           origin_location_id = excluded.origin_location_id`,
      )
      .run(
        rumor.id,
        rumor.text,
        rumor.introducedGameDay,
        rumor.sourceThreadId ?? null,
        rumor.available ? 1 : 0,
        rumor.originLocationId ?? null,
      );
  }

  loadAllRumors(): Rumor[] {
    const rows = this.db
      .prepare('SELECT * FROM rumors ORDER BY introduced_game_day ASC, id ASC')
      .all() as RumorRow[];
    return rows.map(this.rowToRumor);
  }

  loadAvailableRumors(): Rumor[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM rumors WHERE available = 1 ORDER BY introduced_game_day ASC, id ASC',
      )
      .all() as RumorRow[];
    return rows.map(this.rowToRumor);
  }

  countRumorsIntroducedOnDay(gameDay: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM rumors WHERE introduced_game_day = ?')
      .get(gameDay) as { n: number };
    return row.n;
  }

  private rowToRumor = (r: RumorRow): Rumor => ({
    id: r.id,
    text: r.text,
    introducedGameDay: r.introduced_game_day,
    sourceThreadId: r.source_thread_id ?? undefined,
    available: r.available === 1,
    originLocationId: r.origin_location_id ?? undefined,
  });

  // ---------- scheduled_arrivals ----------

  saveScheduledArrival(arrival: ScheduledArrival): void {
    this.db
      .prepare(
        `INSERT INTO scheduled_arrivals (npc_id, display_name, scheduled_game_day, scheduled_sub_tick, archetype, origin_location_id, carried_rumor_ids)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(npc_id) DO UPDATE SET
           display_name = excluded.display_name,
           scheduled_game_day = excluded.scheduled_game_day,
           scheduled_sub_tick = excluded.scheduled_sub_tick,
           archetype = excluded.archetype,
           origin_location_id = excluded.origin_location_id,
           carried_rumor_ids = excluded.carried_rumor_ids`,
      )
      .run(
        arrival.npcId,
        arrival.displayName,
        arrival.scheduledGameDay,
        arrival.scheduledSubTick,
        arrival.archetype ?? null,
        arrival.originLocationId ?? null,
        arrival.carriedRumorIds ? JSON.stringify(arrival.carriedRumorIds) : null,
      );
  }

  loadScheduledArrivalsForDay(gameDay: number): ScheduledArrival[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM scheduled_arrivals WHERE scheduled_game_day = ? ORDER BY scheduled_sub_tick ASC',
      )
      .all(gameDay) as ScheduledArrivalRow[];
    return rows.map(this.rowToScheduledArrival);
  }

  loadUpcomingScheduledArrivals(currentGameDay: number, windowDays: number): ScheduledArrival[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM scheduled_arrivals
         WHERE scheduled_game_day >= ? AND scheduled_game_day <= ?
         ORDER BY scheduled_game_day ASC, scheduled_sub_tick ASC`,
      )
      .all(currentGameDay, currentGameDay + windowDays) as ScheduledArrivalRow[];
    return rows.map(this.rowToScheduledArrival);
  }

  deleteScheduledArrival(npcId: string): void {
    this.db.prepare('DELETE FROM scheduled_arrivals WHERE npc_id = ?').run(npcId);
  }

  private rowToScheduledArrival = (r: ScheduledArrivalRow): ScheduledArrival => ({
    npcId: r.npc_id,
    displayName: r.display_name,
    scheduledGameDay: r.scheduled_game_day,
    scheduledSubTick: r.scheduled_sub_tick,
    archetype: r.archetype ?? undefined,
    originLocationId: r.origin_location_id ?? undefined,
    carriedRumorIds: r.carried_rumor_ids ? JSON.parse(r.carried_rumor_ids) : undefined,
  });

  close(): void {
    this.db.close();
  }
}
