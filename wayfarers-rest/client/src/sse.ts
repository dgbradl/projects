import type { Dispatch } from 'react';
import type {
  EventLogEntry,
  Npc,
  NpcDiff,
  WorldSnapshot,
  WorldState,
} from '@shared/types';
import { api } from './api.ts';
import type { Action } from './state/actions.ts';

const INTERACTION_FLASH_SUBTICKS = 3;

export interface SubscribeOptions {
  subTickIntervalMs: number;
}

export function subscribe(
  dispatch: Dispatch<Action>,
  opts: SubscribeOptions,
): () => void {
  let stopped = false;
  let source: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  const open = () => {
    if (stopped) return;
    source = new EventSource('/stream');

    source.addEventListener('state', (ev: MessageEvent<string>) => {
      const data = JSON.parse(ev.data) as WorldState;
      dispatch({ type: 'STATE_UPDATE', payload: data });
    });

    source.addEventListener('npcs_snapshot', (ev: MessageEvent<string>) => {
      const data = JSON.parse(ev.data) as Npc[];
      dispatch({ type: 'NPCS_SNAPSHOT', payload: data });
    });

    source.addEventListener('npcs_diff', (ev: MessageEvent<string>) => {
      const data = JSON.parse(ev.data) as NpcDiff;
      dispatch({ type: 'NPCS_DIFF', payload: data });
    });

    source.addEventListener('world_snapshot', (ev: MessageEvent<string>) => {
      const data = JSON.parse(ev.data) as WorldSnapshot;
      dispatch({ type: 'WORLD_SNAPSHOT', payload: data });
    });

    source.addEventListener('world_event', (ev: MessageEvent<string>) => {
      const data = JSON.parse(ev.data) as EventLogEntry;
      dispatch({ type: 'WORLD_EVENT', payload: data });
      if (data.event.type === 'interaction') {
        dispatch({
          type: 'INTERACTION_FLASH',
          payload: {
            npcIds: data.event.interaction.participantIds,
            expiresAt:
              Date.now() + opts.subTickIntervalMs * INTERACTION_FLASH_SUBTICKS,
            overheardText: data.event.interaction.overheardText,
          },
        });
      }
    });

    source.addEventListener('flavor_status', (ev: MessageEvent<string>) => {
      const data = JSON.parse(ev.data) as {
        mode: import('@shared/types').FlavorMode;
        pools: import('@shared/types').FlavorPoolStatus[];
      };
      dispatch({ type: 'FLAVOR_STATUS', payload: data });
    });

    source.onerror = () => {
      if (stopped) return;
      source?.close();
      source = null;
      reconnectTimer = setTimeout(async () => {
        try {
          const [state, npcs, world] = await Promise.all([
            api.getState(),
            api.getNpcs(),
            api.getWorld(),
          ]);
          if (stopped) return;
          dispatch({ type: 'INIT_STATE', payload: state });
          dispatch({ type: 'NPCS_SNAPSHOT', payload: npcs });
          dispatch({ type: 'WORLD_SNAPSHOT', payload: world });
        } catch {
          // open() retries the SSE connection anyway
        }
        open();
      }, 1_000);
    };
  };

  open();

  return () => {
    stopped = true;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    source?.close();
  };
}
