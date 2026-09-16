import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import path from 'path'
import pkg from './package.json' with { type: 'json' }

// Vite defines `globalThis.process.env` as `{}` so browser code can read
// process.env. That literal is truthy, so PGlite 0.4's own browser check
// `if (globalThis.process?.env)` folds to always-true and its body runs bare:
// "process is not defined" the moment the legacy engine is constructed, which
// breaks the 0.4 -> 0.5 migration for every user. Rewriting to a `typeof` form
// before define runs restores the check. 0.5 hoists it to a local, so it's fine.
const restorePgliteProcessGuard = {
  name: 'restore-pglite-process-guard',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (!id.includes('pglite-v4') || !code.includes('globalThis.process?.env')) return null;
    return code.replaceAll('globalThis.process?.env', "(typeof globalThis.process !== 'undefined')");
  },
};

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    restorePgliteProcessGuard,
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
          // WebLLM runtime (~12 MB) — desktop-only, cached on first use by the
          // webllm-runtime route in sw.ts.
          '**/web-llm-*.js',
          '**/worker-*.js',
          // Legacy engines: loaded only to upgrade a leftover v0.3/v0.4 database
          // (see pglite-migrate.ts), never on the boot path.
          '**/pglite-v3-*.js',
          '**/pglite-v4-*.js',
          '**/pglite-tools-*.js',
          '**/pglite-engine-*.js',
          '**/pg_dump-*.wasm',
          // Their wasm/data/initdb/pg_trgm, by EXACT hash: all three engines
          // share the pglite-*, initdb-* and pg_trgm.tar-* prefixes, so a
          // wildcard would also drop the live engine's copies and break offline
          // boot. These hashes change whenever the pglite-v3/v4 deps are bumped;
          // the deploy workflow fails the build if one drifts.
          '**/pglite-BdRI_ZYT.wasm',    // v0.3
          '**/pglite-COscPi1Y.data',    // v0.3
          '**/pglite-Da2HFqb0.wasm',    // v0.4
          '**/pglite-D8goAydL.data',    // v0.4
          '**/initdb-Ctytb-lQ.wasm',    // v0.4
          '**/pg_trgm.tar-3zayjqji.gz', // v0.4
        ],
        maximumFileSizeToCacheInBytes: 15 * 1024 * 1024, // 15 MB for large WASM files
        // Pages 308s /index.html -> /, and serving a redirected response to a
        // navigation is a hard network error. Precache the shell under its
        // canonical URL. Must match createHandlerBoundToURL('/') in src/sw.ts.
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
    exclude: ['@electric-sql/pglite', 'pglite-v4', '@electric-sql/pglite-tools'],
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
        manualChunks(id, { getModuleInfo }) {
          // True when no chain of static importers reaches the module from an
          // entry, i.e. it only ever loads through a dynamic import(). Cycles
          // and unknown modules count as static, keeping them in the boot chunk.
          // Not the same as "migration-only": if a React.lazy route became the
          // sole importer of a PGlite module it would move into pglite-engine,
          // which is excluded from the precache — breaking offline boot.
          const lazyOnly = (moduleId: string, stack: Set<string>): boolean => {
            const info = getModuleInfo(moduleId);
            if (!info || info.isEntry || stack.has(moduleId)) return false;
            stack.add(moduleId);
            const lazy = info.importers.length === 0
              ? info.dynamicImporters.length > 0
              : info.importers.every((importer) => lazyOnly(importer, stack));
            stack.delete(moduleId);
            return lazy;
          };
          // React MUST be claimed first, or it gets absorbed into whichever
          // chunk reaches it (it was landing in 'tiptap'), forcing every chunk
          // to import the 750 KB editor bundle just to get jsx-runtime.
          if (/node_modules\/(react|react-dom|scheduler)\//.test(id)) return 'react-vendor';
          // These names are matched by injectManifest.globIgnores above —
          // renaming a rule silently un-excludes its chunk. Keep both in sync.
          if (id.includes('pglite-v3')) return 'pglite-v3';
          // Claimed before the '@electric-sql/pglite' rule below, which would
          // otherwise pull them into the boot-path chunk (pglite-tools' id
          // contains it).
          if (id.includes('pglite-v4')) return 'pglite-v4';
          if (id.includes('@electric-sql/pglite-tools')) return 'pglite-tools';
          // The migration's fallback imports the full engine on the main thread.
          if (id.includes('@electric-sql/pglite') && lazyOnly(id, new Set())) return 'pglite-engine';
          if (id.includes('@mlc-ai/web-llm')) return 'web-llm';
          if (id.includes('@electric-sql/pglite')) return 'pglite';
          // Deliberately no 'tiptap' / 'ui-libs' rules: a manual chunk acts as
          // an attractor for shared modules, so grouping TipTap dragged React
          // and the Radix primitives in with it, putting the 750 KB editor on
          // every route's import graph. Automatic splitting keeps it lazy.
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
