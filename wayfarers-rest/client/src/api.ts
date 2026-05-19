import type {
  ChroniclesSinceResponse,
  DailyChronicleWithLedger,
  FlavorMode,
  FlavorPoolStatus,
  InterventionExecuteResponse,
  InterventionKind,
  InterventionOptionsResponse,
  Npc,
  TavernConfig,
  WorldSnapshot,
  WorldState,
} from '@shared/types';

export interface FlavorStatusResponse {
  mode: FlavorMode;
  pools: FlavorPoolStatus[];
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
  postAcknowledge: async (acknowledgedGameDay: number): Promise<WorldState> => {
    const res = await fetch('/chronicles/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ acknowledgedGameDay }),
    });
    if (!res.ok) throw new Error(`POST /chronicles/acknowledge failed: ${res.status}`);
    return (await res.json()) as WorldState;
  },
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
