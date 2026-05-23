import { useEffect, useRef, useState } from 'react';
import { api } from '../api.ts';
import { useDispatch, useStore } from '../state/store.tsx';

/**
 * Hamburger menu in the top-right of the app header. Exposes the keeper's
 * session controls — Pause / Stop / Resume / Reset — backed by /control/*.
 *
 * State transitions:
 *   running  → Pause | Stop | Reset
 *   paused   → Resume | Reset
 *   stopped  → Resume | Reset
 *
 * Resume is hidden when the world is already running (and the existing
 * PauseOverlay also offers a Continue button on auto-pause, which calls the
 * same /engagement endpoint).
 */
export function MenuButton() {
  const { world } = useStore();
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click / Escape — standard dropdown behavior.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setConfirmingReset(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        setConfirmingReset(false);
      }
    };
    window.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!world) return null;

  const isPaused = world.status === 'paused';
  const isStopped = world.status === 'stopped';
  const isRunning = world.status === 'running';

  const run = async (
    action: 'pause' | 'stop' | 'resume' | 'reset',
  ) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = await api.postControl(action);
      dispatch({ type: 'STATE_UPDATE', payload: next });
      // After reset the live SSE stream re-pushes state/npcs/world; the menu
      // just closes. After pause/stop/resume the state has flipped so the
      // next render shows the right items.
      setOpen(false);
      setConfirmingReset(false);
    } catch (err) {
      console.error(`menu: ${action} failed`, err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="menu-button" ref={rootRef}>
      <button
        type="button"
        className="menu-button-toggle"
        aria-label="Menu"
        aria-expanded={open}
        data-testid="menu-button"
        onClick={() => {
          setOpen((v) => !v);
          setConfirmingReset(false);
        }}
      >
        <span className="menu-button-bars" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>

      {open && (
        <div className="menu-dropdown" role="menu" data-testid="menu-dropdown">
          {isRunning && (
            <>
              <MenuItem
                label="Pause"
                hint="Freeze the tavern. Days stop advancing."
                onClick={() => run('pause')}
                disabled={busy}
                testId="menu-pause"
              />
              <MenuItem
                label="Stop"
                hint="Sleep-mode. Pauses days and idles the chronicle + flavor workers."
                onClick={() => run('stop')}
                disabled={busy}
                testId="menu-stop"
              />
            </>
          )}
          {(isPaused || isStopped) && (
            <MenuItem
              label={isStopped ? 'Wake the tavern' : 'Resume'}
              hint={
                isStopped
                  ? 'Unstop and let the workers and tick clock pick up again.'
                  : 'Unpause and continue.'
              }
              onClick={() => run('resume')}
              disabled={busy}
              testId="menu-resume"
            />
          )}

          <div className="menu-divider" />

          {!confirmingReset ? (
            <MenuItem
              label="Reset to zero…"
              hint="Wipe the world and start a fresh game. Cached flavor is preserved."
              onClick={() => setConfirmingReset(true)}
              disabled={busy}
              testId="menu-reset"
              dangerous
            />
          ) : (
            <div className="menu-reset-confirm" data-testid="menu-reset-confirm">
              <p>
                Everything in this tavern — NPCs, threads, chronicles, coin —
                will be lost.
              </p>
              <div className="menu-reset-actions">
                <button
                  type="button"
                  className="menu-reset-cancel"
                  onClick={() => setConfirmingReset(false)}
                  disabled={busy}
                  data-testid="menu-reset-cancel"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="menu-reset-confirm-button"
                  onClick={() => run('reset')}
                  disabled={busy}
                  data-testid="menu-reset-confirm-button"
                >
                  {busy ? 'Resetting…' : 'Reset everything'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface MenuItemProps {
  label: string;
  hint: string;
  onClick: () => void;
  disabled?: boolean;
  dangerous?: boolean;
  testId?: string;
}

function MenuItem({ label, hint, onClick, disabled, dangerous, testId }: MenuItemProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`menu-item${dangerous ? ' menu-item-dangerous' : ''}`}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      <span className="menu-item-label">{label}</span>
      <span className="menu-item-hint">{hint}</span>
    </button>
  );
}
