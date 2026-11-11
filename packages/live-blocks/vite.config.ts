import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { reactBlockPieces } from './build/pieces.ts';

// The published build: ES modules a host imports with no plugin. Each piece of a block's page
// (build/pieces.ts) and the react block compiler are chunks of their own, loaded only when a
// block needs them. React and what the compiler runs on (sucrase, Tailwind) are the host's.
export default defineConfig({
  plugins: [react(), reactBlockPieces()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: {
        index: path.resolve(import.meta.dirname, 'src/index.ts'),
        core: path.resolve(import.meta.dirname, 'src/core.ts'),
        ui: path.resolve(import.meta.dirname, 'src/ui.ts'),
      },
      formats: ['es'],
    },
    rolldownOptions: {
      external: [/^react($|\/)/, /^react-dom($|\/)/, 'sucrase', 'tailwindcss'],
    },
  },
});
