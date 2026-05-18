import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/**
 * Loader for `recorded` flavor mode. Each slot has a directory under
 * `FLAVOR_FIXTURES_DIR/{slotName}/` containing JSON files. The recorded-mode
 * slot generator pops them in declaration order, cycling when exhausted.
 */
export class FixtureRegistry {
  private cursors = new Map<string, number>();
  private fixtures = new Map<string, unknown[]>();

  constructor(public readonly rootDir: string) {}

  load(): void {
    if (!existsSync(this.rootDir)) return;
    for (const entry of readdirSync(this.rootDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const slot = entry.name;
      const dir = join(this.rootDir, slot);
      const items: unknown[] = [];
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.json')) continue;
        try {
          items.push(JSON.parse(readFileSync(join(dir, file), 'utf8')));
        } catch {
          // skip malformed
        }
      }
      this.fixtures.set(slot, items);
    }
  }

  /** Cycle through the slot's fixtures. Returns undefined if none exist. */
  next<T>(slot: string, validator?: z.ZodType<T>): T | undefined {
    const items = this.fixtures.get(slot);
    if (!items || items.length === 0) return undefined;
    const cursor = this.cursors.get(slot) ?? 0;
    const raw = items[cursor % items.length];
    this.cursors.set(slot, cursor + 1);
    if (validator) {
      const parsed = validator.safeParse(raw);
      if (!parsed.success) return undefined;
      return parsed.data;
    }
    return raw as T;
  }

  has(slot: string): boolean {
    const items = this.fixtures.get(slot);
    return !!items && items.length > 0;
  }
}
