import {
  createContext,
  useContext,
  useReducer,
  type Dispatch,
  type ReactNode,
} from 'react';
import type { Action } from './actions.ts';
import { initialState, reducer, type AppState } from './reducer.ts';

interface StoreContextValue {
  state: AppState;
  dispatch: Dispatch<Action>;
}

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  return (
    <StoreContext.Provider value={{ state, dispatch }}>
      {children}
    </StoreContext.Provider>
  );
}

export function useStore(): AppState {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx.state;
}

export function useDispatch(): Dispatch<Action> {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useDispatch must be used within StoreProvider');
  return ctx.dispatch;
}
