import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Furnishings } from '../src/components/Furnishings.tsx';

describe('Furnishings', () => {
  beforeEach(() => localStorage.clear());

  it('renders the default furniture layout', () => {
    render(<Furnishings />);
    const layer = screen.getByTestId('furnishings');
    expect(layer.querySelectorAll('.furniture')).toHaveLength(5);
  });

  it('shows a rotate handle only on the selected piece', () => {
    render(<Furnishings />);
    expect(screen.queryByTestId('furniture-rotate-table-b')).toBeNull();
    fireEvent.pointerDown(screen.getByTestId('furniture-table-b'));
    expect(screen.getByTestId('furniture-rotate-table-b')).toBeTruthy();
  });
});
