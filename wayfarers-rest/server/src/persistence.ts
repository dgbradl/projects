import Database from 'better-sqlite3';
import type {
  Character,
  ChroniclePrologue,
  DailyChronicle,
  DailyLedger,
  EventLogEntry,
  FurniturePiece,
  InterventionRecord,
  Rumor,
  ScheduledArrival,
  StaffSkills,
  Thread,
  TickEvent,
  WorldEvent,
  WorldState,
  WorldTag,
} from '@shared/types';
import type { RosterSnapshot } from './npc/manager.ts';
import { emptyMemory, parseCharacterMemory } from './npc/character-memory.ts';
import { COIN_INITIAL_DEFAULT } from './economy/ledger.ts';
import { PROSPERITY_INITIAL } from './economy/prosperity.ts';

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
  favors: number;
  favors_last_regen_game_day: number;
  marked_npc_ids: string;
  coin: number;
  prosperity: number;
  larder_stock: number;
  hearth_level: number;
}

interface DailyLedgerRow {
  game_day: number;
  income: number;
  expense: number;
  net: number;
  guest_count: number;
  coin_after: number;
  prosperity_after: number | null;
}

interface InterventionRow {
  id: string;
  kind: string;
  game_day: number;
  real_timestamp: string;
  cost: number;
  cost_currency: string;
  payload: string;
  effect: string;
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
  player_origin: number | null;
  tone: string | null;
}

interface CharacterRow {
  id: string;
  display_name: string;
  archetype: string;
  first_seen_game_day: number;
  last_seen_game_day: number;
  visit_count: number;
  memory: string;
  is_staff: number | null;
  staff_role: string | null;
  skills: string | null;
  personality: string | null;
  is_active_staff: number | null;
}

interface ScheduledArrivalRow {
  npc_id: string;
  display_name: string;
  scheduled_game_day: number;
  scheduled_sub_tick: number;
  archetype: string | null;
  origin_location_id: string | null;
  carried_rumor_ids: string | null;
  was_beckoned: number | null;
}

const DEFAULT_ROSTER_JSON = '{"npcs":[],"spawnQueue":[]}';
const DEFAULT_MEMORY_JSON = JSON.stringify(emptyMemory());

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

      CREATE TABLE IF NOT EXISTS furniture (
        id        TEXT PRIMARY KEY,
        sprite    TEXT NOT NULL,
        x         REAL NOT NULL,
        y         REAL NOT NULL,
        rotation  REAL NOT NULL,
        scale     REAL NOT NULL,
        layer     INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_furniture_layer ON furniture(layer);

      CREATE TABLE IF NOT EXISTS zones (
        name    TEXT PRIMARY KEY,
        x       REAL NOT NULL,
        y       REAL NOT NULL,
        radius  REAL NOT NULL
      );

      CREATE TABLE IF NOT EXISTS scheduled_arrivals (
        npc_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        scheduled_game_day INTEGER NOT NULL,
        scheduled_sub_tick INTEGER NOT NULL,
        archetype TEXT,
        origin_location_id TEXT,
        carried_rumor_ids TEXT,
        was_beckoned INTEGER NOT NULL DEFAULT 0
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

      CREATE TABLE IF NOT EXISTS interventions (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        game_day INTEGER NOT NULL,
        real_timestamp TEXT NOT NULL,
        cost INTEGER NOT NULL,
        payload TEXT NOT NULL,
        effect TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_interventions_game_day ON interventions(game_day);

      CREATE TABLE IF NOT EXISTS characters (
        id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL,
        archetype TEXT NOT NULL,
        first_seen_game_day INTEGER NOT NULL,
        last_seen_game_day INTEGER NOT NULL,
        visit_count INTEGER NOT NULL DEFAULT 0,
        memory TEXT NOT NULL DEFAULT '${DEFAULT_MEMORY_JSON}'
      );

      CREATE TABLE IF NOT EXISTS daily_ledgers (
        game_day INTEGER PRIMARY KEY,
        income INTEGER NOT NULL,
        expense INTEGER NOT NULL,
        net INTEGER NOT NULL,
        guest_count INTEGER NOT NULL,
        coin_after INTEGER NOT NULL,
        prosperity_after REAL
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
    this.addColumnIfMissing('world_state', 'favors', 'INTEGER NOT NULL DEFAULT 3');
    this.addColumnIfMissing(
      'world_state',
      'favors_last_regen_game_day',
      'INTEGER NOT NULL DEFAULT 0',
    );
    this.addColumnIfMissing(
      'world_state',
      'marked_npc_ids',
      "TEXT NOT NULL DEFAULT '[]'",
    );
    this.addColumnIfMissing(
      'world_state',
      'coin',
      `INTEGER NOT NULL DEFAULT ${COIN_INITIAL_DEFAULT}`,
    );
    this.addColumnIfMissing(
      'world_state',
      'prosperity',
      `REAL NOT NULL DEFAULT ${PROSPERITY_INITIAL}`,
    );
    this.addColumnIfMissing('daily_ledgers', 'prosperity_after', 'REAL');
    this.addColumnIfMissing(
      'world_state',
      'larder_stock',
      'INTEGER NOT NULL DEFAULT 0',
    );
    this.addColumnIfMissing(
      'world_state',
      'hearth_level',
      'INTEGER NOT NULL DEFAULT 0',
    );
    this.addColumnIfMissing(
      'interventions',
      'cost_currency',
      "TEXT NOT NULL DEFAULT 'favor'",
    );
    this.addColumnIfMissing(
      'characters',
      'memory',
      `TEXT NOT NULL DEFAULT '${DEFAULT_MEMORY_JSON}'`,
    );
    this.addColumnIfMissing('characters', 'is_staff', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumnIfMissing('characters', 'staff_role', 'TEXT');
    this.addColumnIfMissing('characters', 'skills', 'TEXT');
    this.addColumnIfMissing('characters', 'personality', 'TEXT');
    this.addColumnIfMissing('characters', 'is_active_staff', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumnIfMissing('rumors', 'player_origin', 'INTEGER NOT NULL DEFAULT 0');
    this.addColumnIfMissing('rumors', 'tone', 'TEXT');
    this.addColumnIfMissing(
      'scheduled_arrivals',
      'was_beckoned',
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
    if (
      row.status !== 'running' &&
      row.status !== 'paused' &&
      row.status !== 'stopped'
    ) {
      throw new Error(`Invalid status in DB: ${row.status}`);
    }
    let markedNpcIds: string[] = [];
    try {
      const parsed = JSON.parse(row.marked_npc_ids ?? '[]');
      if (Array.isArray(parsed)) {
        markedNpcIds = parsed.filter((x): x is string => typeof x === 'string');
      }
    } catch {
      markedNpcIds = [];
    }
    const state: WorldState = {
      gameDay: row.game_day,
      lastTickAt: row.last_tick_at,
      status: row.status,
      unattendedTicks: row.unattended_ticks,
      seed: row.seed,
      subTick: row.sub_tick,
      lastAcknowledgedGameDay: row.last_acknowledged_game_day ?? 0,
      favors: row.favors ?? 0,
      favorsLastRegenGameDay: row.favors_last_regen_game_day ?? 0,
      markedNpcIds,
      coin: row.coin ?? COIN_INITIAL_DEFAULT,
      prosperity: row.prosperity ?? PROSPERITY_INITIAL,
    };
    // Economy (E3): larder/hearth are optional — omit at the base level so a
    // fresh tavern's state stays minimal (and round-trips cleanly).
    if (row.larder_stock) state.larderStock = row.larder_stock;
    if (row.hearth_level) state.hearthLevel = row.hearth_level;
    return state;
  }

  saveState(state: WorldState): void {
    this.db
      .prepare(
        `INSERT INTO world_state (id, game_day, last_tick_at, status, unattended_ticks, seed, sub_tick, last_acknowledged_game_day, favors, favors_last_regen_game_day, marked_npc_ids, coin, prosperity, larder_stock, hearth_level)
         VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           game_day = excluded.game_day,
           last_tick_at = excluded.last_tick_at,
           status = excluded.status,
           unattended_ticks = excluded.unattended_ticks,
           seed = excluded.seed,
           sub_tick = excluded.sub_tick,
           last_acknowledged_game_day = excluded.last_acknowledged_game_day,
           favors = excluded.favors,
           favors_last_regen_game_day = excluded.favors_last_regen_game_day,
           marked_npc_ids = excluded.marked_npc_ids,
           coin = excluded.coin,
           prosperity = excluded.prosperity,
           larder_stock = excluded.larder_stock,
           hearth_level = excluded.hearth_level`,
      )
      .run(
        state.gameDay,
        state.lastTickAt,
        state.status,
        state.unattendedTicks,
        state.seed,
        state.subTick,
        state.lastAcknowledgedGameDay,
        state.favors,
        state.favorsLastRegenGameDay,
        JSON.stringify(state.markedNpcIds ?? []),
        state.coin,
        state.prosperity,
        state.larderStock ?? 0,
        state.hearthLevel ?? 0,
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

  // ---------- furniture (server-owned tavern layout) ----------

  saveFurniturePiece(piece: FurniturePiece): void {
    this.db
      .prepare(
        `INSERT INTO furniture (id, sprite, x, y, rotation, scale, layer)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           sprite = excluded.sprite,
           x = excluded.x,
           y = excluded.y,
           rotation = excluded.rotation,
           scale = excluded.scale,
           layer = excluded.layer`,
      )
      .run(piece.id, piece.sprite, piece.x, piece.y, piece.rotation, piece.scale, piece.layer);
  }

  loadAllFurniture(): FurniturePiece[] {
    const rows = this.db
      .prepare(
        'SELECT id, sprite, x, y, rotation, scale, layer FROM furniture ORDER BY layer ASC, id ASC',
      )
      .all() as FurniturePiece[];
    return rows.map((r) => ({
      id: r.id,
      sprite: r.sprite,
      x: r.x,
      y: r.y,
      rotation: r.rotation,
      scale: r.scale,
      layer: r.layer,
    }));
  }

  deleteFurniturePiece(id: string): boolean {
    const res = this.db.prepare('DELETE FROM furniture WHERE id = ?').run(id);
    return res.changes > 0;
  }

  deleteAllFurniture(): void {
    this.db.exec('DELETE FROM furniture');
  }

  // ---------- zones (debug-editable tavern zones) ----------

  saveZone(zone: { name: string; x: number; y: number; radius: number }): void {
    this.db
      .prepare(
        `INSERT INTO zones (name, x, y, radius) VALUES (?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET
           x = excluded.x,
           y = excluded.y,
           radius = excluded.radius`,
      )
      .run(zone.name, zone.x, zone.y, zone.radius);
  }

  loadAllZones(): Array<{ name: string; x: number; y: number; radius: number }> {
    return this.db
      .prepare('SELECT name, x, y, radius FROM zones ORDER BY name ASC')
      .all() as Array<{ name: string; x: number; y: number; radius: number }>;
  }

  deleteZone(name: string): boolean {
    const res = this.db.prepare('DELETE FROM zones WHERE name = ?').run(name);
    return res.changes > 0;
  }

  deleteAllZones(): void {
    this.db.exec('DELETE FROM zones');
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
        `INSERT INTO rumors (id, text, introduced_game_day, source_thread_id, available, origin_location_id, player_origin, tone)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           text = excluded.text,
           introduced_game_day = excluded.introduced_game_day,
           source_thread_id = excluded.source_thread_id,
           available = excluded.available,
           origin_location_id = excluded.origin_location_id,
           player_origin = excluded.player_origin,
           tone = excluded.tone`,
      )
      .run(
        rumor.id,
        rumor.text,
        rumor.introducedGameDay,
        rumor.sourceThreadId ?? null,
        rumor.available ? 1 : 0,
        rumor.originLocationId ?? null,
        rumor.playerOrigin ? 1 : 0,
        rumor.tone ?? null,
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
    playerOrigin: r.player_origin === 1 ? true : undefined,
    tone: (r.tone as Rumor['tone']) ?? undefined,
  });

  loadRumorById(id: string): Rumor | null {
    const row = this.db
      .prepare('SELECT * FROM rumors WHERE id = ?')
      .get(id) as RumorRow | undefined;
    if (!row) return null;
    return this.rowToRumor(row);
  }

  // ---------- scheduled_arrivals ----------

  saveScheduledArrival(arrival: ScheduledArrival): void {
    this.db
      .prepare(
        `INSERT INTO scheduled_arrivals (npc_id, display_name, scheduled_game_day, scheduled_sub_tick, archetype, origin_location_id, carried_rumor_ids, was_beckoned)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(npc_id) DO UPDATE SET
           display_name = excluded.display_name,
           scheduled_game_day = excluded.scheduled_game_day,
           scheduled_sub_tick = excluded.scheduled_sub_tick,
           archetype = excluded.archetype,
           origin_location_id = excluded.origin_location_id,
           carried_rumor_ids = excluded.carried_rumor_ids,
           was_beckoned = excluded.was_beckoned`,
      )
      .run(
        arrival.npcId,
        arrival.displayName,
        arrival.scheduledGameDay,
        arrival.scheduledSubTick,
        arrival.archetype ?? null,
        arrival.originLocationId ?? null,
        arrival.carriedRumorIds ? JSON.stringify(arrival.carriedRumorIds) : null,
        arrival.wasBeckoned ? 1 : 0,
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
    wasBeckoned: r.was_beckoned === 1 ? true : undefined,
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

  // ---------- interventions ----------

  insertIntervention(record: InterventionRecord): void {
    this.db
      .prepare(
        `INSERT INTO interventions (id, kind, game_day, real_timestamp, cost, cost_currency, payload, effect)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.kind,
        record.gameDay,
        record.realTimestamp,
        record.cost,
        record.costCurrency,
        JSON.stringify(record.payload),
        JSON.stringify(record.effect),
      );
  }

  loadInterventionsForDay(gameDay: number): InterventionRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM interventions WHERE game_day = ? ORDER BY real_timestamp ASC, id ASC',
      )
      .all(gameDay) as InterventionRow[];
    return rows.map(this.rowToIntervention);
  }

  loadRecentInterventions(limit: number): InterventionRecord[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM interventions ORDER BY game_day DESC, real_timestamp DESC LIMIT ?',
      )
      .all(limit) as InterventionRow[];
    return rows.map(this.rowToIntervention);
  }

  countInterventionsOnDay(gameDay: number): number {
    const row = this.db
      .prepare('SELECT COUNT(*) AS n FROM interventions WHERE game_day = ?')
      .get(gameDay) as { n: number };
    return row.n;
  }

  countInterventionsBetween(fromGameDay: number, toGameDay: number): number {
    const row = this.db
      .prepare(
        'SELECT COUNT(*) AS n FROM interventions WHERE game_day >= ? AND game_day <= ?',
      )
      .get(fromGameDay, toGameDay) as { n: number };
    return row.n;
  }

  private rowToIntervention = (r: InterventionRow): InterventionRecord => ({
    id: r.id,
    kind: r.kind as InterventionRecord['kind'],
    gameDay: r.game_day,
    realTimestamp: r.real_timestamp,
    cost: r.cost,
    costCurrency:
      (r.cost_currency as InterventionRecord['costCurrency']) ?? 'favor',
    payload: JSON.parse(r.payload),
    effect: JSON.parse(r.effect),
  });

  /**
   * Returns a function that runs `fn` inside a SQLite transaction.
   * The function is synchronous (better-sqlite3 transactions are sync).
   */
  transaction<T>(fn: () => T): T {
    const wrapped = this.db.transaction(fn);
    return wrapped();
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

  // ---------- characters (Phase 7) ----------

  loadCharacter(id: string): Character | null {
    const row = this.db
      .prepare('SELECT * FROM characters WHERE id = ?')
      .get(id) as CharacterRow | undefined;
    if (!row) return null;
    return this.rowToCharacter(row);
  }

  upsertCharacter(character: Character): void {
    this.db
      .prepare(
        `INSERT INTO characters
          (id, display_name, archetype, first_seen_game_day, last_seen_game_day, visit_count, memory, is_staff, staff_role, skills, personality, is_active_staff)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           display_name = excluded.display_name,
           archetype = excluded.archetype,
           first_seen_game_day = excluded.first_seen_game_day,
           last_seen_game_day = excluded.last_seen_game_day,
           visit_count = excluded.visit_count,
           memory = excluded.memory,
           is_staff = excluded.is_staff,
           staff_role = excluded.staff_role,
           skills = excluded.skills,
           personality = excluded.personality,
           is_active_staff = excluded.is_active_staff`,
      )
      .run(
        character.id,
        character.displayName,
        character.archetype,
        character.firstSeenGameDay,
        character.lastSeenGameDay,
        character.visitCount,
        JSON.stringify(character.memory),
        character.isStaff ? 1 : 0,
        character.staffRole ?? null,
        character.skills ? JSON.stringify(character.skills) : null,
        character.personality ?? null,
        character.isActiveStaff ? 1 : 0,
      );
  }

  loadAllCharacters(): Character[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM characters ORDER BY first_seen_game_day ASC, id ASC',
      )
      .all() as CharacterRow[];
    return rows.map(this.rowToCharacter);
  }

  loadStaffCharacters(): Character[] {
    const rows = this.db
      .prepare("SELECT * FROM characters WHERE is_staff = 1 ORDER BY id ASC")
      .all() as CharacterRow[];
    return rows.map(this.rowToCharacter);
  }

  loadActiveStaffCharacters(): Character[] {
    const rows = this.db
      .prepare("SELECT * FROM characters WHERE is_staff = 1 AND is_active_staff = 1 ORDER BY id ASC")
      .all() as CharacterRow[];
    return rows.map(this.rowToCharacter);
  }

  setStaffActive(id: string): void {
    this.db.prepare("UPDATE characters SET is_active_staff = 1 WHERE id = ?").run(id);
  }

  setStaffInactive(id: string): void {
    this.db.prepare("UPDATE characters SET is_active_staff = 0 WHERE id = ?").run(id);
  }

  private rowToCharacter = (r: CharacterRow): Character => ({
    id: r.id,
    displayName: r.display_name,
    archetype: r.archetype as Character['archetype'],
    firstSeenGameDay: r.first_seen_game_day,
    lastSeenGameDay: r.last_seen_game_day,
    visitCount: r.visit_count,
    memory: parseCharacterMemory(r.memory),
    isStaff: r.is_staff === 1 ? true : undefined,
    staffRole: r.staff_role ? (r.staff_role as Character['staffRole']) : undefined,
    skills: r.skills ? (JSON.parse(r.skills) as StaffSkills) : undefined,
    personality: r.personality ?? undefined,
    isActiveStaff: r.is_active_staff === 1 ? true : undefined,
  });

  // ---------- daily_ledgers (Economy E1) ----------

  upsertDailyLedger(ledger: DailyLedger): void {
    this.db
      .prepare(
        `INSERT INTO daily_ledgers (game_day, income, expense, net, guest_count, coin_after, prosperity_after)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(game_day) DO UPDATE SET
           income = excluded.income,
           expense = excluded.expense,
           net = excluded.net,
           guest_count = excluded.guest_count,
           coin_after = excluded.coin_after,
           prosperity_after = excluded.prosperity_after`,
      )
      .run(
        ledger.gameDay,
        ledger.income,
        ledger.expense,
        ledger.net,
        ledger.guestCount,
        ledger.coinAfter,
        ledger.prosperityAfter ?? null,
      );
  }

  loadDailyLedger(gameDay: number): DailyLedger | null {
    const row = this.db
      .prepare('SELECT * FROM daily_ledgers WHERE game_day = ?')
      .get(gameDay) as DailyLedgerRow | undefined;
    return row ? this.rowToDailyLedger(row) : null;
  }

  loadDailyLedgersBetween(fromDay: number, toDay: number): DailyLedger[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM daily_ledgers WHERE game_day >= ? AND game_day <= ? ORDER BY game_day ASC',
      )
      .all(fromDay, toDay) as DailyLedgerRow[];
    return rows.map(this.rowToDailyLedger);
  }

  private rowToDailyLedger = (r: DailyLedgerRow): DailyLedger => ({
    gameDay: r.game_day,
    income: r.income,
    expense: r.expense,
    net: r.net,
    guestCount: r.guest_count,
    coinAfter: r.coin_after,
    prosperityAfter: r.prosperity_after ?? undefined,
  });

  close(): void {
    this.db.close();
  }

  /**
   * Wipe every table that holds per-game state, leaving only the flavor cache
   * (and schema_meta) intact. Used by POST /control/reset to give the keeper a
   * fresh tavern without paying for LLM regeneration of all pool content.
   *
   * The world_state row is deleted; the caller is expected to re-seed a fresh
   * state via WorldStateManager.reset() and then re-run the world init.
   */
  wipeGameTables(): void {
    this.db.exec(`
      BEGIN;
      DELETE FROM world_state;
      DELETE FROM tick_events;
      DELETE FROM events;
      DELETE FROM threads;
      DELETE FROM world_tags;
      DELETE FROM rumors;
      DELETE FROM scheduled_arrivals;
      DELETE FROM chronicles;
      DELETE FROM chronicle_prologues;
      DELETE FROM interventions;
      DELETE FROM characters;
      DELETE FROM daily_ledgers;
      COMMIT;
    `);
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
