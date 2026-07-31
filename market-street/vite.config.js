import { defineConfig } from 'vite';

// BASE_PATH is set by the Pages deploy workflow (e.g. /market-street/).
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
  test: {
    include: ['tests/unit/**/*.test.js'],
  },
});
