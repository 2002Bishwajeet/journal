import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import path from 'path'
import pkg from './package.json' with { type: 'json' }

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    ...(mode === 'production'
      ? [babel({ presets: [reactCompilerPreset()] })]
      : []),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: 'auto',
      includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
      manifest: {
        name: 'Journal',
        short_name: 'Journal',
        description: 'Premium markdown note-taking app powered by Homebase',
        theme_color: '#FDFCF8',
        background_color: '#FDFCF8',
        display: 'standalone',
        display_override: ['window-controls-overlay', 'standalone'],
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png'
          }
        ],
        shortcuts: [
          {
            name: "New Note",
            short_name: "New Note",
            description: "Create a new note",
            url: "/?action=new",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          },
          {
            name: "Search",
            short_name: "Search",
            description: "Search your notes",
            url: "/?action=search",
            icons: [{ src: "pwa-192x192.png", sizes: "192x192" }]
          }
        ],
        share_target: {
          action: "/share-target",
          method: "GET",
          enctype: "application/x-www-form-urlencoded",
          params: {
            title: "title",
            text: "text",
            url: "url"
          }
        }
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2,wasm,data,gz}'],
        globIgnores: [
          // WebLLM runtime (~12 MB) — mobile can never run AI, desktop loads it
          // on demand. Cached on first use via the webllm-runtime route in sw.ts.
          '**/web-llm-*.js',
          '**/worker-*.js',
          // Retired PGlite v0.3 engine — loaded lazily only to migrate a leftover
          // v0.3 database (see pglite-migrate.ts). Never on the boot path.
          '**/pglite-v3-*.js',
          // v0.3 WASM + data. Excluded by EXACT hashed name: the live v0.4 engine
          // shares the pglite-*.{wasm,data} prefix and MUST stay precached for
          // offline use, so a wildcard here would break the DB. These two files
          // are referenced solely by the pglite-v3-*.js chunk; the hashes change
          // if the pglite-v3 dependency is updated.
          '**/pglite-BdRI_ZYT.wasm',
          '**/pglite-COscPi1Y.data',
        ],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024, // 15 MB for large WASM files
        // Cloudflare Pages canonicalizes /index.html -> / with a 308, so every
        // fetch of the precached shell (install, and PrecacheStrategy's network
        // fallback on a cache miss) comes back with response.redirected = true.
        // Serving a redirected response to a navigation — whose redirect mode is
        // "manual" — is a hard network error, i.e. "This site can't be reached"
        // on any cold precache. Precaching the shell under its canonical URL
        // keeps the response redirect-free. Must stay in sync with
        // createHandlerBoundToURL('/') in src/sw.ts.
        manifestTransforms: [
          (entries) => ({
            manifest: entries.map((e) =>
              e.url === 'index.html' ? { ...e, url: '/' } : e
            ),
            warnings: [],
          }),
        ],
      },
      devOptions: {
        enabled: false, // Disable in dev to avoid cache errors
        type: 'module',
      }
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite'],
  },
  server: {
    host: 'dev.dotyou.cloud',
    port: 5173,
    https: {
      key: fs.readFileSync('./dev-dotyou-cloud.key'),
      cert: fs.readFileSync('./dev-dotyou-cloud.crt'),
    },
    headers: {
      // Required for OPFS/WebLLM and SharedArrayBuffer
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    fs: {
      allow: ['..'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // React MUST be claimed first. Without this it gets absorbed into
          // whichever manual chunk happens to reach it (it was landing in
          // 'tiptap'), which forces every chunk in the app to import the
          // 750 KB editor bundle just to get jsx-runtime.
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
          // These three names are matched by sw.ts globIgnores — renaming or
          // removing a rule silently un-excludes its chunk from the precache
          // (web-llm alone is ~6 MB). Keep the names in sync with sw.ts.
          if (id.includes('pglite-v3')) return 'pglite-v3';
          if (id.includes('@mlc-ai/web-llm')) return 'web-llm';
          if (id.includes('@electric-sql/pglite')) return 'pglite';
          // Deliberately no 'tiptap' / 'ui-libs' rules. A manual chunk acts as
          // an attractor for shared modules, so grouping TipTap dragged
          // unrelated deps (React, then the Radix primitives) in with it —
          // which put the 750 KB editor bundle on every route's import graph.
          // Automatic splitting keeps the editor in the lazy EditorPage chunk.
        }
      }
    }
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
  },
}))
