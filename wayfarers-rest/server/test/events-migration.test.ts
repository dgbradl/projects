import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { Persistence } from '../src/persistence.ts';

describe('Phase 1 -> Phase 3 event-log migration', () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'wayfarers-migration-'));
    dbPath = join(dir, 'world.db');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('copies legacy tick_events rows into the new events table on first boot, idempotently', () => {
    // 1) Open Persistence once to install schema. Migration runs but has no rows.
    {
      const p = new Persistence(dbPath);
      p.appendLegacyTickEvent({
        gameDay: 1,
        realTimestamp: '2026-01-01T00:00:00.000Z',
        type: 'init',
        payload: { seed: 'old' },
      });
      p.appendLegacyTickEvent({
        gameDay: 2,
        realTimestamp: '2026-01-02T00:00:00.000Z',
        type: 'tick',
        payload: {},
      });
      p.close();
    }

    // 2) Reset migration flag + clear events table to simulate a Phase 1 DB
    //    that has never seen Phase 3.
    {
      const direct = new Database(dbPath);
      direct.exec("DELETE FROM schema_meta WHERE key = 'phase3_events_migrated'");
      direct.exec('DELETE FROM events');
      direct.close();
    }

    // 3) Reopen via Persistence — migration must copy the two legacy rows.
    const p2 = new Persistence(dbPath);
    const events = p2.getEventsSince(0);
    expect(events).toHaveLength(2);
    expect(events[0].event.type).toBe('init');
    expect(events[1].event.type).toBe('tick');
    expect(events[0].realTimestamp).toBe('2026-01-01T00:00:00.000Z');
    p2.close();

    // 4) Reopening again must be a no-op (idempotent).
    const p3 = new Persistence(dbPath);
    expect(p3.getEventsSince(0)).toHaveLength(2);
    p3.close();
  });
});
