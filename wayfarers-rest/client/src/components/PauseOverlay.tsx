import { useState } from 'react';
import { api } from '../api.ts';
import { useDispatch, useStore } from '../state/store.tsx';

const MAX_UNATTENDED_TICKS = 7;

/**
 * Overlay shown when the world is not running. Three distinct copies:
 *  - auto-pause (7 unattended ticks)      — original Phase 5 copy
 *  - manual pause (via the menu)           — Phase 7
 *  - sleep-mode stop (via the menu)        — Phase 7; surfaces "the tavern is shuttered"
 */
export function PauseOverlay() {
  const { world } = useStore();
  const dispatch = useDispatch();
  const [busy, setBusy] = useState(false);

  if (!world || (world.status !== 'paused' && world.status !== 'stopped')) {
    return null;
  }

  const onContinue = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await api.postControl('resume');
      dispatch({ type: 'STATE_UPDATE', payload: next });
    } finally {
      setBusy(false);
    }
  };

  const isStopped = world.status === 'stopped';
  const isAutoPause =
    !isStopped && world.unattendedTicks >= MAX_UNATTENDED_TICKS;

  const { heading, body, button } = isStopped
    ? {
        heading: 'The tavern is shuttered.',
        body: 'You have closed the doors. The fire is banked, the lanterns dimmed.',
        button: 'Reopen',
      }
    : isAutoPause
      ? {
          heading: 'The tavern rests.',
          body: 'Seven days have passed unattended. The fire burns low; the road waits.',
          button: 'Continue',
        }
      : {
          heading: 'A held breath.',
          body: 'You have stepped behind the bar to think. The world waits on you.',
          button: 'Continue',
        };

  return (
    <div className="pause-overlay" data-testid="pause-overlay">
      <div className="pause-card">
        <h2>{heading}</h2>
        <p>{body}</p>
        <button
          type="button"
          className="pause-continue"
          onClick={onContinue}
          disabled={busy}
          data-testid="continue-button"
        >
          {busy ? 'Resuming…' : button}
        </button>
      </div>
    </div>
  );
}
