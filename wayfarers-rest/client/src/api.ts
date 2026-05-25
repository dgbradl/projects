import type {
  ChroniclesSinceResponse,
  DailyChronicleWithLedger,
  FlavorMode,
  FlavorPoolStatus,
  FurniturePiece,
  InterventionExecuteResponse,
  InterventionKind,
  InterventionOptionsResponse,
  Npc,
  TavernConfig,
  TickerResponse,
  WorldSnapshot,
  WorldState,
  Zone,
} from '@shared/types';

export interface FlavorStatusResponse {
  mode: FlavorMode;
  pools: FlavorPoolStatus[];
}

export type LayerMove = 'back' | 'backward' | 'forward' | 'front';

export interface PlaceFurnitureInput {
  sprite: string;
  x: number;
  y: number;
  rotation?: number;
  scale?: number;
}

export interface PatchFurnitureInput {
  x?: number;
  y?: number;
  rotation?: number;
  scale?: number;
}

export interface PlaceZoneInput {
  name: string;
  x: number;
  y: number;
  radius: number;
}

export interface PatchZoneInput {
  x?: number;
  y?: number;
  radius?: number;
}

async function jsonGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  getState: () => jsonGet<WorldState>('/state'),
  getTavern: () => jsonGet<TavernConfig>('/tavern'),
  getNpcs: () => jsonGet<Npc[]>('/npcs'),
  getWorld: () => jsonGet<WorldSnapshot>('/world'),
  getFlavor: () => jsonGet<FlavorStatusResponse>('/flavor'),
  getChroniclesSince: () => jsonGet<ChroniclesSinceResponse>('/chronicles/since'),
  getChronicle: (day: number) =>
    jsonGet<DailyChronicleWithLedger>(`/chronicles/${day}`),
  postEngagement: async (): Promise<WorldState> => {
    const res = await fetch('/engagement', { method: 'POST' });
    if (!res.ok) throw new Error(`POST /engagement failed: ${res.status}`);
    return (await res.json()) as WorldState;
  },
  // Phase 7 menu actions. Resume reuses /engagement under the hood; we expose
  // it here as /control/resume so the client can use a single namespace.
  postControl: async (
    action: 'pause' | 'stop' | 'resume' | 'reset',
  ): Promise<WorldState> => {
    const res = await fetch(`/control/${action}`, { method: 'POST' });
    if (!res.ok) throw new Error(`POST /control/${action} failed: ${res.status}`);
    return (await res.json()) as WorldState;
  },
  postAcknowledge: async (acknowledgedGameDay: number): Promise<WorldState> => {
    const res = await fetch('/chronicles/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acknowledgedGameDay }),
    });
    if (!res.ok) throw new Error(`POST /chronicles/acknowledge failed: ${res.status}`);
    return (await res.json()) as WorldState;
  },
  // ----- F3 furniture -----
  listFurniture: () => jsonGet<FurniturePiece[]>('/furniture'),
  placeFurniture: async (input: PlaceFurnitureInput): Promise<FurniturePiece> => {
    const res = await fetch('/furniture', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`POST /furniture failed: ${res.status}`);
    return (await res.json()) as FurniturePiece;
  },
  patchFurniture: async (
    id: string,
    patch: PatchFurnitureInput,
  ): Promise<FurniturePiece> => {
    const res = await fetch(`/furniture/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`PATCH /furniture/${id} failed: ${res.status}`);
    return (await res.json()) as FurniturePiece;
  },
  moveFurnitureLayer: async (
    id: string,
    move: LayerMove,
  ): Promise<FurniturePiece[]> => {
    const res = await fetch(`/furniture/${encodeURIComponent(id)}/layer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ move }),
    });
    if (!res.ok)
      throw new Error(`POST /furniture/${id}/layer failed: ${res.status}`);
    return (await res.json()) as FurniturePiece[];
  },
  deleteFurniture: async (id: string): Promise<void> => {
    const res = await fetch(`/furniture/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204)
      throw new Error(`DELETE /furniture/${id} failed: ${res.status}`);
  },

  // ----- D2 zones (debug editor) -----
  listZones: () => jsonGet<Zone[]>('/zones'),
  placeZone: async (input: PlaceZoneInput): Promise<Zone> => {
    const res = await fetch('/zones', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { error?: string }).error ?? `POST /zones failed: ${res.status}`,
      );
    }
    return (await res.json()) as Zone;
  },
  patchZone: async (name: string, patch: PatchZoneInput): Promise<Zone> => {
    const res = await fetch(`/zones/${encodeURIComponent(name)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`PATCH /zones/${name} failed: ${res.status}`);
    return (await res.json()) as Zone;
  },
  removeZone: async (name: string): Promise<void> => {
    const res = await fetch(`/zones/${encodeURIComponent(name)}`, {
      method: 'DELETE',
    });
    if (!res.ok && res.status !== 204)
      throw new Error(`DELETE /zones/${name} failed: ${res.status}`);
  },
  resetZones: async (): Promise<Zone[]> => {
    const res = await fetch('/zones/reset', { method: 'POST' });
    if (!res.ok) throw new Error(`POST /zones/reset failed: ${res.status}`);
    return (await res.json()) as Zone[];
  },

  // Phase 8 (B1/B2): live ticker feed.
  getRecentEvents: (sinceEventId: number, limit = 50) =>
    jsonGet<TickerResponse>(
      `/events/recent?sinceEventId=${sinceEventId}&limit=${limit}`,
    ),

  getInterventionOptions: () =>
    jsonGet<InterventionOptionsResponse>('/interventions/options'),
  postIntervention: async (
    kind: InterventionKind,
    payload: Record<string, unknown>,
  ): Promise<InterventionExecuteResponse> => {
    const res = await fetch('/interventions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, payload }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(
        (body as { error?: string }).error ?? `POST /interventions failed: ${res.status}`,
      );
    }
    return (await res.json()) as InterventionExecuteResponse;
  },
};
