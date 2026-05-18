import Database from 'better-sqlite3';
import type {
  ChroniclePrologue,
  DailyChronicle,
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
  last_acknowledged_game_day: number;
}

interface ChronicleRow {
  game_day: number;
  generated_at_real_ts: string | null;
  status: string;
  headlines_json: string;
  footnotes_json: string;
  model_used: string | null;
  prompt_char_count: number | null;
  completion_char_count: number | null;
  generation_duration_ms: number | null;
  failure_reason: string | null;
}

interface PrologueRow {
  from_game_day: number;
  to_game_day: number;
  text: string;
  generated_at_real_ts: string;
  status: string;
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

      CREATE TABLE IF NOT EXISTS flavor_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL,
        sub_key TEXT NOT NULL DEFAULT '',
        content_json TEXT NOT NULL,
        generated_at_real_ts TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_flavor_cache_kind ON flavor_cache(kind, sub_key);

      CREATE TABLE IF NOT EXISTS chronicles (
        game_day INTEGER PRIMARY KEY,
        generated_at_real_ts TEXT,
        status TEXT NOT NULL,
        headlines_json TEXT NOT NULL,
        footnotes_json TEXT NOT NULL,
        model_used TEXT,
        prompt_char_count INTEGER,
        completion_char_count INTEGER,
        generation_duration_ms INTEGER,
        failure_reason TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_chronicles_status ON chronicles(status, game_day);

      CREATE TABLE IF NOT EXISTS chronicle_prologues (
        from_game_day INTEGER NOT NULL,
        to_game_day INTEGER NOT NULL,
        text TEXT NOT NULL,
        generated_at_real_ts TEXT NOT NULL,
        status TEXT NOT NULL,
        PRIMARY KEY (from_game_day, to_game_day)
      );
    `);

    this.addColumnIfMissing('world_state', 'sub_tick', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumnIfMissing(
      'world_state',
      'roster',
      `TEXT NOT NULL DEFAULT '${DEFAULT_ROSTER_JSON}'`,
    );
    this.addColumnIfMissing(
      'world_state',
      'last_acknowledged_game_day',
      'INTEGER NOT NULL DEFAULT 0',
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
      lastAcknowledgedGameDay: row.last_acknowledged_game_day ?? 0,
    };
  }

  saveState(state: WorldState): void {
    this.db
      .prepare(
        `INSERT INTO world_state (id, game_day, last_tick_at, status, unattended_ticks, seed, sub_tick, last_acknowledged_game_day)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           game_day = excluded.game_day,
           last_tick_at = excluded.last_tick_at,
           status = excluded.status,
           unattended_ticks = excluded.unattended_ticks,
           seed = excluded.seed,
           sub_tick = excluded.sub_tick,
           last_acknowledged_game_day = excluded.last_acknowledged_game_day`,
      )
      .run(
        state.gameDay,
        state.lastTickAt,
        state.status,
        state.unattendedTicks,
        state.seed,
        state.subTick,
        state.lastAcknowledgedGameDay,
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

  // ---------- flavor_cache ----------

  insertFlavorCacheItem(
    kind: string,
    subKey: string,
    contentJson: string,
    generatedAtRealTs: string,
  ): number {
    const result = this.db
      .prepare(
        'INSERT INTO flavor_cache (kind, sub_key, content_json, generated_at_real_ts) VALUES (?, ?, ?, ?)',
      )
      .run(kind, subKey, contentJson, generatedAtRealTs);
    return Number(result.lastInsertRowid);
  }

  loadFlavorCacheItems(): Array<{
    id: number;
    kind: string;
    subKey: string;
    contentJson: string;
    generatedAtRealTs: string;
  }> {
    const rows = this.db
      .prepare(
        'SELECT id, kind, sub_key, content_json, generated_at_real_ts FROM flavor_cache ORDER BY id ASC',
      )
      .all() as Array<{
      id: number;
      kind: string;
      sub_key: string;
      content_json: string;
      generated_at_real_ts: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      subKey: r.sub_key,
      contentJson: r.content_json,
      generatedAtRealTs: r.generated_at_real_ts,
    }));
  }

  deleteFlavorCacheItem(id: number): void {
    this.db.prepare('DELETE FROM flavor_cache WHERE id = ?').run(id);
  }

  // ---------- chronicles ----------

  upsertChronicle(chronicle: DailyChronicle): void {
    this.db
      .prepare(
        `INSERT INTO chronicles
          (game_day, generated_at_real_ts, status, headlines_json, footnotes_json,
           model_used, prompt_char_count, completion_char_count, generation_duration_ms, failure_reason)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_day) DO UPDATE SET
           generated_at_real_ts = excluded.generated_at_real_ts,
           status = excluded.status,
           headlines_json = excluded.headlines_json,
           footnotes_json = excluded.footnotes_json,
           model_used = excluded.model_used,
           prompt_char_count = excluded.prompt_char_count,
           completion_char_count = excluded.completion_char_count,
           generation_duration_ms = excluded.generation_duration_ms,
           failure_reason = excluded.failure_reason`,
      )
      .run(
        chronicle.gameDay,
        chronicle.generatedAtRealTs,
        chronicle.status,
        JSON.stringify(chronicle.headlines),
        JSON.stringify(chronicle.footnotes),
        chronicle.modelUsed,
        chronicle.promptCharCount,
        chronicle.completionCharCount,
        chronicle.generationDurationMs,
        chronicle.failureReason,
      );
  }

  loadChronicle(gameDay: number): DailyChronicle | null {
    const row = this.db
      .prepare('SELECT * FROM chronicles WHERE game_day = ?')
      .get(gameDay) as ChronicleRow | undefined;
    if (!row) return null;
    return this.rowToChronicle(row);
  }

  loadChroniclesBetween(fromDay: number, toDay: number): DailyChronicle[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM chronicles WHERE game_day >= ? AND game_day <= ? ORDER BY game_day ASC',
      )
      .all(fromDay, toDay) as ChronicleRow[];
    return rows.map((r) => this.rowToChronicle(r));
  }

  loadPendingChronicleGameDays(): number[] {
    const rows = this.db
      .prepare(
        "SELECT game_day FROM chronicles WHERE status IN ('pending','in_progress') ORDER BY game_day ASC",
      )
      .all() as Array<{ game_day: number }>;
    return rows.map((r) => r.game_day);
  }

  loadAllChronicleGameDays(): number[] {
    const rows = this.db
      .prepare('SELECT game_day FROM chronicles ORDER BY game_day ASC')
      .all() as Array<{ game_day: number }>;
    return rows.map((r) => r.game_day);
  }

  private rowToChronicle = (r: ChronicleRow): DailyChronicle => ({
    gameDay: r.game_day,
    generatedAtRealTs: r.generated_at_real_ts,
    status: r.status as DailyChronicle['status'],
    headlines: safeParseArray(r.headlines_json),
    footnotes: safeParseArray(r.footnotes_json),
    modelUsed: r.model_used,
    promptCharCount: r.prompt_char_count,
    completionCharCount: r.completion_char_count,
    generationDurationMs: r.generation_duration_ms,
    failureReason: r.failure_reason,
  });

  // ---------- chronicle prologues ----------

  upsertChroniclePrologue(prologue: ChroniclePrologue): void {
    this.db
      .prepare(
        `INSERT INTO chronicle_prologues
          (from_game_day, to_game_day, text, generated_at_real_ts, status)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(from_game_day, to_game_day) DO UPDATE SET
           text = excluded.text,
           generated_at_real_ts = excluded.generated_at_real_ts,
           status = excluded.status`,
      )
      .run(
        prologue.fromGameDay,
        prologue.toGameDay,
        prologue.text,
        prologue.generatedAtRealTs,
        prologue.status,
      );
  }

  loadChroniclePrologue(
    fromGameDay: number,
    toGameDay: number,
  ): ChroniclePrologue | null {
    const row = this.db
      .prepare(
        'SELECT * FROM chronicle_prologues WHERE from_game_day = ? AND to_game_day = ?',
      )
      .get(fromGameDay, toGameDay) as PrologueRow | undefined;
    if (!row) return null;
    return {
      fromGameDay: row.from_game_day,
      toGameDay: row.to_game_day,
      text: row.text,
      generatedAtRealTs: row.generated_at_real_ts,
      status: row.status as ChroniclePrologue['status'],
    };
  }

  close(): void {
    this.db.close();
  }
}

function safeParseArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}
