import { useEffect } from 'react';
import { api } from './api.ts';
import { DebugPanel } from './components/DebugPanel.tsx';
import { PauseOverlay } from './components/PauseOverlay.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { Tavern } from './components/Tavern.tsx';
import { subscribe } from './sse.ts';
import { StoreProvider, useDispatch, useStore } from './state/store.tsx';

function Bootstrap() {
  const dispatch = useDispatch();
  const { tavern } = useStore();

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    (async () => {
      try {
        const [tavernConfig, state, npcs, world, flavor] = await Promise.all([
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
        dispatch({ type: 'WORLD_SNAPSHOT', payload: world });
        dispatch({ type: 'FLAVOR_STATUS', payload: flavor });
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

  // Expire interaction flashes once per second.
  useEffect(() => {
    const interval = setInterval(() => {
      dispatch({ type: 'EXPIRE_INTERACTION_FLASHES', payload: { now: Date.now() } });
    }, 1_000);
    return () => clearInterval(interval);
  }, [dispatch]);

  return (
    <div className="app">
      <header className="app-header">
        <h1>The Wayfarer's Rest</h1>
        <StatusBar />
      </header>
      <main className="app-main">
        <Tavern />
        <PauseOverlay />
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
