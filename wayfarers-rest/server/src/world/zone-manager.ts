import { EventEmitter } from 'node:events';
import type { Zone } from '@shared/types';
import { WALKABLE } from '@shared/space';
import type { Persistence } from '../persistence.ts';
import { TAVERN_ZONES, setActiveZones } from './tavern.ts';

const MIN_RADIUS = 1;
const MAX_RADIUS = 40;
const MAX_NAME_LEN = 60;
const NAME_RE = /^[\w-]+$/;

export interface PlaceZoneInput {
  name: string;
  x: number;
  y: number;
  radius: number;
}

export type PatchZoneInput = Partial<{ x: number; y: number; radius: number }>;

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateName(name: unknown): string {
  if (typeof name !== 'string') throw new Error('invalid name');
  if (name.length === 0 || name.length > MAX_NAME_LEN) throw new Error('invalid name');
  if (!NAME_RE.test(name)) throw new Error('invalid name');
  return name;
}

function clampX(x: number): number {
  return clamp(x, WALKABLE.minX, WALKABLE.maxX);
}

function clampY(y: number): number {
  return clamp(y, WALKABLE.minY, WALKABLE.maxY);
}

function clampRadius(r: number): number {
  return clamp(r, MIN_RADIUS, MAX_RADIUS);
}

/**
 * Owns the tavern's zone layout. Seeds from TAVERN_ZONES on first boot and
 * persists user edits/additions/deletions in sqlite. After every mutation
 * the module-level active-zone registry (tavern.ts) is refreshed so
 * behavior.ts / spawn.ts / pickPositionInZone see the live list without
 * needing the manager threaded through their signatures.
 */
export class ZoneManager extends EventEmitter {
  constructor(private readonly persistence: Persistence) {
    super();
    if (this.persistence.loadAllZones().length === 0) {
      this.seedDefaults();
    }
    this.refreshRegistry();
  }

  private seedDefaults(): void {
    for (const z of TAVERN_ZONES) this.persistence.saveZone(z);
  }

  private refreshRegistry(): void {
    setActiveZones(this.list());
  }

  list(): Zone[] {
    return this.persistence.loadAllZones();
  }

  get(name: string): Zone | undefined {
    return this.list().find((z) => z.name === name);
  }

  /** Create a new zone. Rejects collisions with existing names. */
  place(input: PlaceZoneInput): Zone {
    const name = validateName(input.name);
    if (!isNum(input.x) || !isNum(input.y) || !isNum(input.radius)) {
      throw new Error('invalid coordinates');
    }
    if (this.get(name)) throw new Error('zone exists');
    const zone: Zone = {
      name,
      x: clampX(input.x),
      y: clampY(input.y),
      radius: clampRadius(input.radius),
    };
    this.persistence.saveZone(zone);
    this.refreshRegistry();
    this.emit('change');
    return zone;
  }

  patch(name: string, input: PatchZoneInput): Zone | null {
    const current = this.get(name);
    if (!current) return null;
    const next: Zone = {
      name: current.name,
      x: isNum(input.x) ? clampX(input.x) : current.x,
      y: isNum(input.y) ? clampY(input.y) : current.y,
      radius: isNum(input.radius) ? clampRadius(input.radius) : current.radius,
    };
    this.persistence.saveZone(next);
    this.refreshRegistry();
    this.emit('change');
    return next;
  }

  remove(name: string): boolean {
    const ok = this.persistence.deleteZone(name);
    if (ok) {
      this.refreshRegistry();
      this.emit('change');
    }
    return ok;
  }

  /** Wipe the zone table and reseed from TAVERN_ZONES. */
  reset(): Zone[] {
    this.persistence.deleteAllZones();
    this.seedDefaults();
    this.refreshRegistry();
    this.emit('change');
    return this.list();
  }
}
