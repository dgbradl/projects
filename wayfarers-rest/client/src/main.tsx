import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './styles/tokens.css';
import './styles/app.css';
import './styles/tavern.css';
import './styles/npc.css';
import './styles/debug.css';
import './styles/welcome.css';
import './styles/intervention.css';
import './styles/ticker.css';
import './styles/open-tavern.css';
import './styles/day-night.css';
import './styles/dock.css';
import './styles/tavern-memory.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
