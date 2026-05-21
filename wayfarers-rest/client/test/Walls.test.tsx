import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Walls } from '../src/components/Walls.tsx';

describe('Walls', () => {
  it('renders the wall fill, edge strips, and corner pieces', () => {
    render(<Walls />);
    const walls = screen.getByTestId('walls');
    expect(walls.querySelectorAll('.wall')).toHaveLength(12);
    expect(walls.querySelectorAll('.wall-fill')).toHaveLength(4);
    expect(walls.querySelectorAll('.wall-corner')).toHaveLength(4);
    expect(walls.querySelectorAll('.wall-edge')).toHaveLength(4);
    for (const corner of ['tl', 'tr', 'bl', 'br']) {
      expect(walls.querySelector(`.wall-corner-${corner}`)).toBeTruthy();
    }
    for (const edge of ['top', 'bottom', 'left', 'right']) {
      expect(walls.querySelector(`.wall-edge-${edge}`)).toBeTruthy();
    }
  });
});
