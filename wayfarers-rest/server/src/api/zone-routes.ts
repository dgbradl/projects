import type { FastifyInstance } from 'fastify';
import type { Zone } from '@shared/types';
import type {
  PatchZoneInput,
  PlaceZoneInput,
  ZoneManager,
} from '../world/zone-manager.ts';

export function registerZoneRoutes(
  app: FastifyInstance,
  manager: ZoneManager,
): void {
  app.get('/zones', async (): Promise<Zone[]> => manager.list());

  app.post<{ Body: PlaceZoneInput }>('/zones', async (req, reply) => {
    try {
      const zone = manager.place(req.body);
      return reply.code(201).send(zone);
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.patch<{ Params: { name: string }; Body: PatchZoneInput }>(
    '/zones/:name',
    async (req, reply) => {
      try {
        const updated = manager.patch(req.params.name, req.body);
        if (!updated) return reply.code(404).send({ error: 'not found' });
        return updated;
      } catch (err) {
        return reply.code(400).send({ error: (err as Error).message });
      }
    },
  );

  app.delete<{ Params: { name: string } }>('/zones/:name', async (req, reply) => {
    const ok = manager.remove(req.params.name);
    return reply.code(ok ? 204 : 404).send();
  });

  app.post('/zones/reset', async (): Promise<Zone[]> => manager.reset());
}
