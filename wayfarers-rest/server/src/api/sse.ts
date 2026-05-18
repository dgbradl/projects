import type { FastifyInstance, FastifyReply } from 'fastify';
import type { WorldState } from '@shared/types';
import type { WorldStateManager } from '../state.ts';

const HEARTBEAT_MS = 30_000;

export function registerSSE(
  app: FastifyInstance,
  stateManager: WorldStateManager,
): void {
  app.get('/stream', (request, reply) => {
    reply.hijack();

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const onState = (state: WorldState) => {
      writeEvent(reply, 'state', state);
    };
    stateManager.on('state', onState);

    // Send the current state to the new subscriber immediately.
    writeEvent(reply, 'state', stateManager.getState());

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(': heartbeat\n\n');
      } catch {
        // connection closed; cleanup handler will fire
      }
    }, HEARTBEAT_MS);
    heartbeat.unref?.();

    const cleanup = () => {
      stateManager.off('state', onState);
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
