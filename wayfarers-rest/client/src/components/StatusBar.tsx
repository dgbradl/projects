import { tierForScore } from '@shared/types';
import { api } from '../api.ts';
import { useDispatch, useStore } from '../state/store.tsx';

type DayPart = 'dawn' | 'morning' | 'midday' | 'afternoon' | 'dusk' | 'night';

function dayPart(subTick: number, subTicksPerDay: number): DayPart {
  if (subTicksPerDay <= 0) return 'morning';
  const t = subTick / subTicksPerDay;
  if (t < 0.12) return 'dawn';
  if (t < 0.33) return 'morning';
  if (t < 0.5) return 'midday';
  if (t < 0.67) return 'afternoon';
  if (t < 0.85) return 'dusk';
  return 'night';
}

/**
 * Top-of-page status surface.
 *
 *   Row 1 (title row)  — handled by App.tsx (tavern name + day part + ☰).
 *                        StatusBar renders only the chip strip; App glues
 *                        the rows together so the menu button stays
 *                        right-aligned without StatusBar caring.
 *   Row 2 (chip strip) — play state (click-to-toggle), patrons, coin,
 *                        favor, prosperity. Sub-tick is no longer in the
 *                        chrome — it's developer telemetry; players read
 *                        time through the day-part label and the day/night
 *                        tint on the tavern floor.
 *
 * Each chip uses the shared design tokens (--surface-*, --text-*, etc.) so
 * the strip reads as a row of pill controls instead of a row of bare text.
 * The favor chip opens the dock's Interventions tab via the existing
 * INTERVENTION_PICKER_OPENED action; the dock auto-switches tabs on that
 * dispatch, so one chip click both opens the picker and surfaces it.
 */
export function StatusBar() {
  const { world, tavern, npcs, coinTips, interventionOptions } = useStore();
  const dispatch = useDispatch();
  if (!world || !tavern) return <div className="status-bar status-bar-loading" />;

  const isRunning = world.status === 'running';
  const togglePlay = async () => {
    try {
      const next = await api.postControl(isRunning ? 'pause' : 'resume');
      dispatch({ type: 'STATE_UPDATE', payload: next });
    } catch (err) {
      // Non-fatal — the menu still offers the same controls.
      console.error('status-bar toggle failed', err);
    }
  };

  const openFavorPicker = async () => {
    try {
      const options = await api.getInterventionOptions();
      dispatch({ type: 'INTERVENTION_OPTIONS_LOADED', payload: options });
      dispatch({ type: 'INTERVENTION_PICKER_OPENED' });
    } catch (err) {
      console.error('status-bar favor click failed', err);
    }
  };

  const part = dayPart(world.subTick, tavern.subTicksPerDay);
  const patrons = Object.keys(npcs).length;
  const favors = world.favors;
  const favorMax = interventionOptions?.favorsMax ?? 5;
  const tier = tierForScore(world.prosperity);

  return (
    <div className="status-strip" data-testid="status-bar">
      <button
        type="button"
        className={`status-chip status-chip--play status-${world.status}`}
        onClick={togglePlay}
        title={isRunning ? 'Pause the tavern' : 'Resume the tavern'}
        data-testid="status-play-toggle"
      >
        <span aria-hidden>{isRunning ? '▶' : '⏸'}</span>
        <span data-testid="status-state">{world.status}</span>
      </button>

      <span className="status-chip" data-testid="status-day-part">
        <span aria-hidden>📅</span>
        Day <strong data-testid="status-day">{world.gameDay}</strong>
        <span className="status-chip-dim">· {part}</span>
      </span>

      <span className="status-chip" data-testid="status-patrons">
        <span aria-hidden>🧑</span>
        <strong>{patrons}</strong>
        <span className="status-chip-dim">patron{patrons === 1 ? '' : 's'}</span>
      </span>

      <span className="status-chip status-chip--coin">
        <span aria-hidden>🪙</span>
        <strong data-testid="status-coin">{world.coin}</strong>
        {/* Floating "+N" coin tips ride on top of the chip; CSS still
            owns the rise + fade animation. */}
        {coinTips.map((tip) => (
          <span key={tip.id} className="coin-tip" aria-hidden>
            +{tip.amount}
          </span>
        ))}
      </span>

      <button
        type="button"
        className="status-chip status-chip--favor"
        onClick={openFavorPicker}
        title={`a new favor at each dawn — ${favors}/${favorMax}`}
        data-testid="status-favor"
        aria-label={`favors: ${favors} of ${favorMax}. click to spend one`}
      >
        <span aria-hidden>⚡</span>
        <strong>{favors}</strong>
        <span className="status-chip-dim">/ {favorMax}</span>
      </button>

      <span className="status-chip status-chip--prosperity" title={`prosperity: ${tier}`}>
        <span aria-hidden>📈</span>
        <strong data-testid="status-prosperity">{tier}</strong>
      </span>
    </div>
  );
}
