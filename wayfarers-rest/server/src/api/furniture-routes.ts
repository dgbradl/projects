import type { FastifyInstance } from 'fastify';
import type { FurniturePiece } from '@shared/types';
import type {
  FurnitureManager,
  LayerMove,
  PatchInput,
  PlaceInput,
} from '../furniture/manager.ts';

const LAYER_MOVES = ['back', 'backward', 'forward', 'front'] as const;

function isLayerMove(v: unknown): v is LayerMove {
  return typeof v === 'string' && (LAYER_MOVES as readonly string[]).includes(v);
}

export function registerFurnitureRoutes(
  app: FastifyInstance,
  manager: FurnitureManager,
): void {
  app.get('/furniture', async (): Promise<FurniturePiece[]> => manager.list());

  app.post<{ Body: PlaceInput }>('/furniture', async (req, reply) => {
    try {
      const piece = manager.place(req.body);
      return reply.code(201).send(piece);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.patch<{ Params: { id: string }; Body: PatchInput }>(
    '/furniture/:id',
    async (req, reply) => {
      try {
        const updated = manager.patch(req.params.id, req.body);
        if (!updated) return reply.code(404).send({ error: 'not found' });
        return updated;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.post<{ Params: { id: string }; Body: { move: unknown } }>(
    '/furniture/:id/layer',
    async (req, reply) => {
      if (!isLayerMove(req.body?.move)) {
        return reply.code(400).send({ error: 'invalid move' });
      }
      return manager.setLayer(req.params.id, req.body.move);
    },
  );

  app.delete<{ Params: { id: string } }>('/furniture/:id', async (req, reply) => {
    const ok = manager.remove(req.params.id);
    return reply.code(ok ? 204 : 404).send();
  });
}
