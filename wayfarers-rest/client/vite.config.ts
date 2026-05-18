import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const SERVER_URL = process.env.WAYFARERS_SERVER_URL ?? 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('../shared/src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/state': SERVER_URL,
      '/npcs': SERVER_URL,
      '/tavern': SERVER_URL,
      '/engagement': SERVER_URL,
      '/events': SERVER_URL,
      '/stream': { target: SERVER_URL, changeOrigin: true, ws: false },
    },
  },
});
