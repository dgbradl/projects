import { useState } from 'react';
import { api } from '../api.ts';
import { useDispatch, useStore } from '../state/store.tsx';

export function PauseOverlay() {
  const { world } = useStore();
  const dispatch = useDispatch();
  const [busy, setBusy] = useState(false);

  if (!world || world.status !== 'paused') return null;

  const onContinue = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await api.postEngagement();
      dispatch({ type: 'STATE_UPDATE', payload: next });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="pause-overlay" data-testid="pause-overlay">
      <div className="pause-card">
        <h2>The tavern rests.</h2>
        <p>
          Seven days have passed unattended. The fire burns low; the road waits.
        </p>
        <button
          type="button"
          className="pause-continue"
          onClick={onContinue}
          disabled={busy}
          data-testid="continue-button"
        >
          {busy ? 'Resuming…' : 'Continue'}
        </button>
      </div>
    </div>
  );
}
