import type { FastifyInstance, FastifyReply } from 'fastify';
import type {
  DailyChronicle,
  EventLogEntry,
  NpcDiff,
  WorldSnapshot,
  WorldState,
} from '@shared/types';
import type { WorldEventBus } from '../events/emitter.ts';
import type { NpcManager } from '../npc/manager.ts';
import type { Persistence } from '../persistence.ts';
import type { WorldStateManager } from '../state.ts';
import { buildFlavorStatus, buildWorldSnapshot, type ApiDeps } from './routes.ts';

const HEARTBEAT_MS = 30_000;

export function registerSSE(
  app: FastifyInstance,
  stateManager: WorldStateManager,
  npcManager: NpcManager,
  bus: WorldEventBus,
  deps: ApiDeps,
): void {
  app.get('/stream', (request, reply) => {
    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const onState = (state: WorldState) => writeEvent(reply, 'state', state);
    const onDiff = (diff: NpcDiff) => writeEvent(reply, 'npcs_diff', diff);
    const onWorldEvent = (entry: EventLogEntry) => {
      writeEvent(reply, 'world_event', entry);
      writeEvent(reply, 'world_snapshot', buildWorldSnapshot(deps));
      if (
        entry.event.type === 'flavor_cache_miss' ||
        entry.event.type === 'flavor_mode_changed'
      ) {
        writeEvent(reply, 'flavor_status', buildFlavorStatus(deps));
      }
      // A fresh `init` is published when POST /control/reset wipes the world.
      // Push the roster snapshot so the client doesn't keep a stale npcs map.
      if (entry.event.type === 'init') {
        writeEvent(reply, 'npcs_snapshot', npcManager.getRoster());
      }
    };

    const onChronicleReady = (chronicle: DailyChronicle) =>
      writeEvent(reply, 'chronicle_ready', chronicle);

    stateManager.on('state', onState);
    npcManager.on('diff', onDiff);
    bus.on('world_event', onWorldEvent);
    deps.chroniclePipeline?.on('ready', onChronicleReady);

    writeEvent(reply, 'state', stateManager.getState());
    writeEvent(reply, 'npcs_snapshot', npcManager.getRoster());
    writeEvent(reply, 'world_snapshot', buildWorldSnapshot(deps));
    writeEvent(reply, 'flavor_status', buildFlavorStatus(deps));

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        // connection closed
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    const cleanup = () => {
      stateManager.off('state', onState);
      npcManager.off('diff', onDiff);
      bus.off('world_event', onWorldEvent);
      deps.chroniclePipeline?.off('ready', onChronicleReady);
      clearInterval(heartbeat);
    };
    request.raw.on('close', cleanup);
    request.raw.on('error', cleanup);
  });
}

function writeEvent(reply: FastifyReply, event: string, data: unknown): void {
  try {
    reply.raw.write(`event: ${event}\n`);
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`);
  } catch {
    // socket may have closed mid-write
  }
}
