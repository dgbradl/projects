import { useEffect } from 'react';
import { api } from './api.ts';
import { DebugPanel } from './components/DebugPanel.tsx';
import { FavorIndicator } from './components/FavorIndicator.tsx';
import { InterventionPicker } from './components/InterventionPicker.tsx';
import { LandingAnimation } from './components/LandingAnimation.tsx';
import { PauseOverlay } from './components/PauseOverlay.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { Tavern } from './components/Tavern.tsx';
import { Welcome } from './components/Welcome.tsx';
import { subscribe } from './sse.ts';
import { StoreProvider, useDispatch, useStore } from './state/store.tsx';

function Bootstrap() {
  const dispatch = useDispatch();
  const { tavern, world, welcome } = useStore();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    (async () => {
      try {
        const [tavernConfig, state, npcs, worldSnap, flavor] = await Promise.all([
          api.getTavern(),
          api.getState(),
          api.getNpcs(),
          api.getWorld(),
          api.getFlavor().catch(() => ({ mode: 'placeholder' as const, pools: [] })),
        ]);
        if (cancelled) return;
        dispatch({ type: 'INIT_TAVERN', payload: tavernConfig });
        dispatch({ type: 'INIT_STATE', payload: state });
        dispatch({ type: 'NPCS_SNAPSHOT', payload: npcs });
        dispatch({ type: 'WORLD_SNAPSHOT', payload: worldSnap });
        dispatch({ type: 'FLAVOR_STATUS', payload: flavor });

        // Phase 5: decide whether to show the welcome view.
        if (state.lastAcknowledgedGameDay < state.gameDay - 1) {
          try {
            const since = await api.getChroniclesSince();
            if (!cancelled) {
              dispatch({ type: 'WELCOME_OPENED', payload: since });
            }
          } catch (err) {
            console.error('failed to load chronicles', err);
          }
        }

        unsubscribe = subscribe(dispatch, {
          subTickIntervalMs: tavernConfig.subTickIntervalMs,
        });
      } catch (err) {
        console.error('bootstrap failed', err);
      }
    })();
    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [dispatch]);

  useEffect(() => {
    const interval = setInterval(() => {
      dispatch({ type: 'EXPIRE_INTERACTION_FLASHES', payload: { now: Date.now() } });
    }, 1_000);
    return () => clearInterval(interval);
  }, [dispatch]);

  // Show Welcome while it's open; the live view sits behind it.
  if (welcome?.show) {
    return <Welcome />;
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>The Wayfarer's Rest</h1>
        <StatusBar />
      </header>
      <main className="app-main">
        <Tavern />
        <PauseOverlay />
        <FavorIndicator />
        <InterventionPicker />
        <LandingAnimation />
        {tavern && <DebugPanel />}
      </main>
    </div>
  );
}

export function App() {
  return (
    <StoreProvider>
      <Bootstrap />
    </StoreProvider>
  );
}
