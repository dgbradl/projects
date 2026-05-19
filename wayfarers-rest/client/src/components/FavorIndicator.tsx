import type { ReactElement } from 'react';
import { api } from '../api.ts';
import { useDispatch, useStore } from '../state/store.tsx';

export function FavorIndicator() {
  const { world, interventionOptions } = useStore();
  const dispatch = useDispatch();
  if (!world) return null;
  const favors = world.favors;
  const max = interventionOptions?.favorsMax ?? 5;

  const openPicker = async () => {
    try {
      const options = await api.getInterventionOptions();
      dispatch({ type: 'INTERVENTION_OPTIONS_LOADED', payload: options });
      dispatch({ type: 'INTERVENTION_PICKER_OPENED' });
    } catch (err) {
      console.error('failed to load intervention options', err);
    }
  };

  const glyphs: ReactElement[] = [];
  for (let i = 0; i < max; i += 1) {
    glyphs.push(
      <span
        key={i}
        className={`favor-glyph ${i < favors ? 'favor-lit' : 'favor-unlit'}`}
        aria-hidden
      />,
    );
  }

  return (
    <button
      type="button"
      className="favor-indicator"
      onClick={openPicker}
      title={`a new favor at each dawn — ${favors}/${max}`}
      data-testid="favor-indicator"
      aria-label={`favors: ${favors} of ${max}. click to use one`}
    >
      <span className="favor-glyphs">{glyphs}</span>
      <span className="favor-count" data-testid="favor-count">
        {favors}/{max}
      </span>
    </button>
  );
}
