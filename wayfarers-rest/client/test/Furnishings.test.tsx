import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Furnishings, STORAGE_KEY } from '../src/components/Furnishings.tsx';

function seed(pieces: unknown) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pieces));
}

describe('Furnishings', () => {
  beforeEach(() => localStorage.clear());

  it('starts with an empty floor', () => {
    render(<Furnishings />);
    expect(
      screen.getByTestId('furnishings').querySelectorAll('.furniture'),
    ).toHaveLength(0);
  });

  it('adds a piece when a sprite is dropped on the floor', () => {
    render(<Furnishings />);
    const layer = screen.getByTestId('furnishings');
    fireEvent.drop(layer, {
      clientX: 120,
      clientY: 90,
      dataTransfer: { getData: () => 'table_round_01' },
    });
    expect(layer.querySelectorAll('.furniture')).toHaveLength(1);
  });

  it('reveals rotate and scale handles on the selected piece', () => {
    seed([
      { id: 'p1', sprite: 'table_round_01', x: 50, y: 50, rotation: 0, scale: 1 },
    ]);
    render(<Furnishings />);
    expect(screen.queryByTestId('furniture-rotate-p1')).toBeNull();
    fireEvent.pointerDown(screen.getByTestId('furniture-p1'));
    expect(screen.getByTestId('furniture-rotate-p1')).toBeTruthy();
    expect(screen.getByTestId('furniture-scale-p1')).toBeTruthy();
  });

  it('applies a piece scale to its rendered width', () => {
    seed([
      { id: 'big', sprite: 'table_round_01', x: 40, y: 50, rotation: 0, scale: 1 },
      { id: 'small', sprite: 'table_round_01', x: 60, y: 50, rotation: 0, scale: 0.5 },
    ]);
    render(<Furnishings />);
    const big = parseFloat(screen.getByTestId('furniture-big').style.width);
    const small = parseFloat(screen.getByTestId('furniture-small').style.width);
    expect(small).toBeCloseTo(big / 2);
  });

  it('copies and pastes the selected piece', () => {
    seed([
      { id: 'p1', sprite: 'table_round_01', x: 50, y: 50, rotation: 0, scale: 1 },
    ]);
    render(<Furnishings />);
    const layer = screen.getByTestId('furnishings');
    fireEvent.pointerDown(screen.getByTestId('furniture-p1'));
    fireEvent.keyDown(document.body, { key: 'c', metaKey: true });
    fireEvent.keyDown(document.body, { key: 'v', metaKey: true });
    expect(layer.querySelectorAll('.furniture')).toHaveLength(2);
  });

  it('restacks a piece with the layer toolbar', () => {
    seed(
      ['a', 'b', 'c'].map((id) => ({
        id,
        sprite: 'table_round_01',
        x: 50,
        y: 50,
        rotation: 0,
        scale: 1,
      })),
    );
    render(<Furnishings />);
    const layer = screen.getByTestId('furnishings');
    const order = () =>
      [...layer.querySelectorAll('.furniture')].map((el) =>
        el.getAttribute('data-testid'),
      );
    expect(order()).toEqual(['furniture-a', 'furniture-b', 'furniture-c']);

    // front piece (c) to the back
    fireEvent.pointerDown(screen.getByTestId('furniture-c'));
    fireEvent.click(screen.getByTestId('furniture-layer-back-c'));
    expect(order()).toEqual(['furniture-c', 'furniture-a', 'furniture-b']);
    // at the back, the send-back buttons disable
    const back = screen.getByTestId('furniture-layer-back-c') as HTMLButtonElement;
    expect(back.disabled).toBe(true);

    // step a one layer forward, past b
    fireEvent.pointerDown(screen.getByTestId('furniture-a'));
    fireEvent.click(screen.getByTestId('furniture-layer-forward-a'));
    expect(order()).toEqual(['furniture-c', 'furniture-b', 'furniture-a']);
  });
});
