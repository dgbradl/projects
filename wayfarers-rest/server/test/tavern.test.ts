import { describe, expect, it } from 'vitest';
import { WALKABLE } from '@shared/space';
import { TAVERN_ZONES } from '../src/world/tavern.ts';

describe('TAVERN_ZONES geometry', () => {
  it('every zone fits inside the walkable rectangle', () => {
    for (const z of TAVERN_ZONES) {
      const insideX = z.x - z.radius >= WALKABLE.minX && z.x + z.radius <= WALKABLE.maxX;
      const insideY = z.y - z.radius >= WALKABLE.minY && z.y + z.radius <= WALKABLE.maxY;
      expect(insideX, `zone ${z.name} x out of walkable`).toBe(true);
      expect(insideY, `zone ${z.name} y out of walkable`).toBe(true);
    }
  });
});
