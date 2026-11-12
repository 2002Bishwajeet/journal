import { defineConfig } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import pkg from './package.json' with { type: 'json' }
// A react or mermaid block's runtime, Tailwind sheet and libraries, which the live-blocks
// package builds; each is a chunk of its own, loaded only when a block needs it.
import { reactBlockPieces } from './packages/live-blocks/build/pieces.ts'

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

// @tiptap/extension-mathematics imports katex at its top, which put KaTeX on every note
// open. Inside that package only, `katex` is src/lib/katexLazy.ts, which loads KaTeX and
// its CSS when math first renders (#673). Pre-bundling would skip this hook, so the
// package is excluded from optimizeDeps below.
const lazyKatexForMath = {
  name: 'lazy-katex-for-math',
  enforce: 'pre' as const,
  resolveId: (source: string, importer: string | undefined) =>
    source === 'katex' && importer?.includes('/@tiptap/extension-mathematics/')
      ? path.resolve(import.meta.dirname, 'src/lib/katexLazy.ts')
      : null,
};

// The app's CSPs (#671, #945), read from public/_headers so dev and preview send what
// Cloudflare Pages sends.
const HEADERS_FILE = fs.readFileSync(path.join(import.meta.dirname, 'public/_headers'), 'utf8');
const APP_CSP = HEADERS_FILE.match(/^\s+Content-Security-Policy-Report-Only: (.+)$/m)![1];
const ENFORCED_CSP = HEADERS_FILE.match(/^\s+Content-Security-Policy: (.+)$/m)![1];

function gitShortSha(): string | undefined {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return undefined;
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(process.env.GITHUB_SHA?.slice(0, 7) ?? gitShortSha() ?? 'dev'),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
  },
  plugins: [
    restorePgliteProcessGuard,
    lazyKatexForMath,
    reactBlockPieces(),
    react(),
    ...(mode === 'production' || mode === 'e2e'
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
        id: '/',
        start_url: '/',
        scope: '/',
        description: 'Offline-first markdown notes, encrypted and synced through your own Homebase identity.',
        categories: ['productivity', 'utilities'],
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
          },
          {
            src: 'pwa-maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ],
        screenshots: [
          { src: 'screenshots/narrow-notes.png', sizes: '1170x2532', type: 'image/png', form_factor: 'narrow', label: 'Your notes, organized in folders' },
          { src: 'screenshots/narrow-note.png', sizes: '1170x2532', type: 'image/png', form_factor: 'narrow', label: 'Write in markdown, even offline' },
          { src: 'screenshots/narrow-search.png', sizes: '1170x2532', type: 'image/png', form_factor: 'narrow', label: 'Find any note fast' },
          { src: 'screenshots/wide-note.png', sizes: '2560x1600', type: 'image/png', form_factor: 'wide', label: 'A note beside your folders' },
          { src: 'screenshots/wide-live-block.png', sizes: '2560x1600', type: 'image/png', form_factor: 'wide', label: 'Live blocks: diagrams and small tools inside a note' }
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
          // iOS launch images (index.html apple-touch-startup-image): iOS fetches them
          // itself when the app is added to the home screen.
          'splash/**',
          // Install-dialog screenshots (manifest `screenshots`): the browser
          // fetches them only when it shows the install dialog.
          'screenshots/**',
          // WebLLM runtime (~12 MB) — desktop-only, cached on first use by the
          // webllm-runtime route in sw.ts.
          '**/web-llm-*.js',
          '**/worker-*.js',
          // A react block's runtime, Tailwind sheet and libraries, and a mermaid block's
          // runtime (reactBlockPieces above; Rolldown names a virtual module's chunk
          // `_virtual_<name>`) and a react block's compiler (packages/live-blocks/src/reactBlockCompiler.ts,
          // with sucrase and Tailwind's compiler): loaded only when such a block is
          // previewed, cached on first use by the react-block route in sw.ts (#426, #427).
          '**/_virtual_react-block-*.js',
          '**/reactBlockCompiler-*.js',
          // Legacy engine: loaded only to upgrade a leftover v0.3/v0.4 database
          // (see pglite-migrate.ts), never on the boot path. A v0.3 dir is read
          // by this same v0.4 engine — both are Postgres 17.
          '**/pglite-v4-*.js',
          '**/pglite-tools-*.js',
          '**/pglite-engine-*.js',
          '**/pg_dump-*.wasm',
          // Its wasm/data/initdb/pg_trgm, by EXACT hash: the live and legacy
          // engines share the pglite-*, initdb-* and pg_trgm.tar-* prefixes, so
          // a wildcard would also drop the live engine's copies and break
          // offline boot. These hashes change whenever the pglite-v4 dep is
          // bumped; the deploy workflow fails the build if one drifts.
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
      '@': path.resolve(import.meta.dirname, './src'),
      // Paid code from the optional private submodule native/, or its stub without it.
      '@premium': path.resolve(import.meta.dirname, fs.existsSync(path.resolve(import.meta.dirname, 'native/web/index.ts')) ? 'native/web/index.ts' : 'src/lib/premiumStub.ts'),
      // The workspace package's source, not the link in node_modules: a worktree that shares
      // another checkout's node_modules still builds its own copy.
      '@2002bishwajeet/live-blocks': path.resolve(import.meta.dirname, './packages/live-blocks/src'),
    },
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite', 'pglite-v4', '@electric-sql/pglite-tools', '@tiptap/extension-mathematics'],
  },
  server: {
    // e2e mode serves plain HTTP on 127.0.0.1 (set by the e2e script via
    // --host/--port) and must not read the dev cert files or bind the dev host.
    ...(mode === 'e2e' ? {} : {
      host: 'dev.dotyou.cloud',
      port: 5173,
      https: {
        key: fs.readFileSync('./dev-dotyou-cloud.key'),
        cert: fs.readFileSync('./dev-dotyou-cloud.crt'),
      },
    }),
    headers: {
      // Required for OPFS/WebLLM and SharedArrayBuffer
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Content-Security-Policy': ENFORCED_CSP,
      'Content-Security-Policy-Report-Only': APP_CSP,
    },
    fs: {
      allow: ['..'],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Groups rather than `manualChunks`: a group pulls in its modules'
        // dependencies, and with one function Vite's dynamic-import helper (used
        // by every lazy chunk, and by mermaid's own lazy diagrams) landed in
        // 'mermaid', putting that 4.8 MB chunk on the boot path. A separate,
        // higher-priority group keeps the helper in a tiny chunk of its own.
        codeSplitting: { groups: [{ name: 'preload-helper', test: /vite\/preload-helper/, priority: 10 }, {
          name(id, ctx) {
          const getModuleInfo = (moduleId: string) => ctx.getModuleInfo(moduleId);
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
          },
        }] },
      }
    }
  },
  preview: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Content-Security-Policy': ENFORCED_CSP,
      'Content-Security-Policy-Report-Only': APP_CSP,
    },
    // The `live`/`live-setup` projects preview the e2e build over HTTPS on
    // e2e.dotyou.cloud:4443 (see e2e/support/make-cert.mjs); every other
    // preview (hermetic e2e, `npm run preview`) stays plain HTTP.
    ...(mode === 'e2e' && process.env.E2E_HTTPS === '1' ? {
      https: {
        key: fs.readFileSync(path.join(certDir(), 'e2e.key')),
        cert: fs.readFileSync(path.join(certDir(), 'e2e.crt')),
      },
    } : {}),
  },
}))

// Mirrors e2e/support/make-cert.mjs's own resolution: E2E_CERT_DIR (CI, #203)
// or the gitignored default e2e/.certs/.
function certDir(): string {
  return process.env.E2E_CERT_DIR
    ? path.resolve(process.env.E2E_CERT_DIR)
    : path.resolve(import.meta.dirname, 'e2e/.certs');
}
