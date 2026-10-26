import { defineConfig } from 'vite'

// The landing page: a static site of its own, built to site/dist for Cloudflare Pages.
// It shares the app's installed packages but none of its code or config.
export default defineConfig({
  root: import.meta.dirname,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Mermaid's diagram chunks (elk is the largest) load only when the playground is used.
    chunkSizeWarningLimit: 1600,
  },
  server: { host: '127.0.0.1', port: 5180, strictPort: true },
  preview: { host: '127.0.0.1', port: 5181, strictPort: true },
})
