import { useEffect } from 'react';
import { api } from './api.ts';
import { PauseOverlay } from './components/PauseOverlay.tsx';
import { StatusBar } from './components/StatusBar.tsx';
import { Tavern } from './components/Tavern.tsx';
import { subscribe } from './sse.ts';
import { StoreProvider, useDispatch } from './state/store.tsx';

function Bootstrap() {
  const dispatch = useDispatch();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [tavern, state, npcs] = await Promise.all([
          api.getTavern(),
          api.getState(),
          api.getNpcs(),
        ]);
        if (cancelled) return;
        dispatch({ type: 'INIT_TAVERN', payload: tavern });
        dispatch({ type: 'INIT_STATE', payload: state });
        dispatch({ type: 'NPCS_SNAPSHOT', payload: npcs });
      } catch (err) {
        console.error('bootstrap failed', err);
      }
    })();
    const unsubscribe = subscribe(dispatch);
    return () => {
      cancelled = true;
      unsubscribe();
    };
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
