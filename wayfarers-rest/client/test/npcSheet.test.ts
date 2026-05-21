import { describe, expect, it } from 'vitest';
import {
  ANIMATIONS,
  cellPosition,
  resolvePose,
} from '../src/sprites/npcSheet.ts';

describe('resolvePose', () => {
  it('walks in the faced direction when moving', () => {
    expect(resolvePose('wandering', true, 'up').animation).toBe(
      ANIMATIONS.walkUp,
    );
    expect(resolvePose('wandering', true, 'down').animation).toBe(
      ANIMATIONS.walkDown,
    );
    const left = resolvePose('wandering', true, 'left');
    expect(left.animation).toBe(ANIMATIONS.walkSide);
    expect(left.flipX).toBe(true);
    expect(resolvePose('wandering', true, 'right').flipX).toBe(false);
  });

  it('sits when seated and stationary', () => {
    expect(resolvePose('seated', false, 'down').animation).toBe(ANIMATIONS.sit);
  });

  it('drinks at the bar when stationary there', () => {
    expect(resolvePose('at_bar', false, 'right').animation).toBe(
      ANIMATIONS.drinkBar,
    );
  });

  it('idles facing the last direction when stationary', () => {
    expect(resolvePose('wandering', false, 'up').animation).toBe(
      ANIMATIONS.idleUp,
    );
    expect(resolvePose('wandering', false, 'down').animation).toBe(
      ANIMATIONS.idleDown,
    );
    expect(resolvePose('wandering', false, 'left').flipX).toBe(true);
  });

  it('lets movement override a stationary status', () => {
    expect(resolvePose('seated', true, 'right').animation).toBe(
      ANIMATIONS.walkSide,
    );
  });
});

describe('cellPosition', () => {
  it('maps cell 0 to the top-left corner', () => {
    expect(cellPosition(0)).toBe('0% 0%');
  });

  it('derives row and column from the cell index', () => {
    // cell 16 = row 1, col 0
    expect(cellPosition(16)).toBe(`0% ${(1 / 15) * 100}%`);
    // cell 17 = row 1, col 1
    expect(cellPosition(17)).toBe(`${(1 / 15) * 100}% ${(1 / 15) * 100}%`);
  });
});
