/**
 * Phase 8 (D2): tavern identity onboarding modal.
 *
 * Shown once, on the first session where the keeper hasn't named the
 * place yet (tavernName is still the project default AND gameDay is 1).
 * The player picks a name and 0-2 traits, then "Opens the doors" — the
 * POST writes both to WorldState and emits a `tavern_named` event so the
 * chronicle records the day the inn got a name.
 *
 * Pure presentation; the gating logic lives in App.tsx.
 */
import { useState } from 'react';
import { DEFAULT_TAVERN_NAME, TAVERN_TRAITS } from '@shared/types';
import type { TavernTrait, WorldState } from '@shared/types';
import { api } from '../api.ts';
import { useDispatch } from '../state/store.tsx';

const TRAIT_LABELS: Record<TavernTrait, string> = {
  hearthside_refuge: "Hearthside refuge — warm to refugees and pilgrims",
  bardic_stage: 'Bardic stage — songs, dances, an audience',
  smugglers_welcome: "Smugglers' welcome — rogues feel at home",
  scholars_quiet: "Scholar's quiet — books, corners, soft voices",
  martial_billet: 'Martial billet — soldiers and knights drink here',
  pilgrims_pause: "Pilgrim's pause — a step on a long road",
  frontier_post: 'Frontier post — wanderers, hunters, refugees passing through',
  arcane_haven: 'Arcane haven — odd visitors, stranger relics',
  trade_crossroads: 'Trade crossroads — a market-route inn',
  hunters_lodge: "Hunter's lodge — game on the wall, a fire by the door",
};

interface Props {
  onComplete: (state: WorldState) => void;
}

export function OpenTavernModal({ onComplete }: Props) {
  const dispatch = useDispatch();
  const [name, setName] = useState(DEFAULT_TAVERN_NAME);
  const [selected, setSelected] = useState<TavernTrait[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (trait: TavernTrait) => {
    setSelected((cur) => {
      if (cur.includes(trait)) return cur.filter((t) => t !== trait);
      if (cur.length >= 2) return cur; // cap at 2
      return [...cur, trait];
    });
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('A tavern needs a name.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.postTavernIdentity({
        tavernName: trimmed,
        tavernTraits: selected,
      });
      dispatch({ type: 'STATE_UPDATE', payload: res.state });
      onComplete(res.state);
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div className="open-tavern" role="dialog" aria-label="Open the tavern">
      <div className="open-tavern-card">
        <h1 className="open-tavern-title">A new tavern, a new keeper.</h1>
        <p className="open-tavern-lede">
          Before you open the doors — what will travellers call this place,
          and what kind of place will it be?
        </p>

        <label className="open-tavern-field">
          <span className="open-tavern-label">Tavern name</span>
          <input
            type="text"
            value={name}
            maxLength={64}
            onChange={(e) => setName(e.target.value)}
            className="open-tavern-input"
            placeholder={DEFAULT_TAVERN_NAME}
            autoFocus
          />
        </label>

        <fieldset className="open-tavern-traits">
          <legend className="open-tavern-label">
            Choose up to two traits ({selected.length}/2)
          </legend>
          <div className="open-tavern-traits-grid">
            {TAVERN_TRAITS.map((trait) => {
              const checked = selected.includes(trait);
              const disabled = !checked && selected.length >= 2;
              return (
                <label
                  key={trait}
                  className={`open-tavern-trait${checked ? ' open-tavern-trait--checked' : ''}${disabled ? ' open-tavern-trait--disabled' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => toggle(trait)}
                  />
                  <span>{TRAIT_LABELS[trait]}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {error && <div className="open-tavern-error">{error}</div>}

        <div className="open-tavern-actions">
          <button
            type="button"
            className="open-tavern-submit"
            disabled={submitting}
            onClick={submit}
          >
            {submitting ? 'Opening the doors…' : 'Open the doors'}
          </button>
        </div>
      </div>
    </div>
  );
}
