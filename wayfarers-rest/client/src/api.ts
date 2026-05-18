import type { Npc, TavernConfig, WorldState } from '@shared/types';

async function jsonGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  getState: () => jsonGet<WorldState>('/state'),
  getTavern: () => jsonGet<TavernConfig>('/tavern'),
  getNpcs: () => jsonGet<Npc[]>('/npcs'),
  postEngagement: async (): Promise<WorldState> => {
    const res = await fetch('/engagement', { method: 'POST' });
    if (!res.ok) throw new Error(`POST /engagement failed: ${res.status}`);
    return (await res.json()) as WorldState;
  },
};
