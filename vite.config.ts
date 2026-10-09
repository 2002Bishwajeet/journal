import { defineConfig, type Plugin } from 'vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { execSync } from 'child_process'
import fs from 'fs'
import { createRequire } from 'module'
import path from 'path'
import { transform as transformCss } from 'lightningcss'
import { rolldown } from 'rolldown'
import { compile as compileTailwind } from 'tailwindcss'
import pkg from './package.json' with { type: 'json' }
import { compactGradients, mergeRules, tailwindInput } from './src/lib/reactBlockTailwind.ts'
import { REACT_BLOCK_LIBRARIES, type ReactBlockLibrary } from './src/lib/reactBlockLibraries.ts'

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

// The React a `react` live block runs on (#426): the app's own installed react and
// react-dom/client as the text of one classic script, which sets window.React and
// window.ReactDOM (react-dom/client with react-dom's own exports, such as the createPortal
// Recharts uses, #427). A block's sandboxed frame cannot load the app's modules, so the app
// inlines this text into the frame's srcdoc. Made from the packages' CommonJS production
// files and a tiny require(), in this build: no second build tool, no generated file.
const appRequire = createRequire(import.meta.url);
function reactBlockRuntime(): string {
  // Each file is read next to its package.json: the packages' `exports` hide their cjs/ files.
  const reactDom = appRequire.resolve('react-dom/package.json');
  const packageFile = (packageJson: string, file: string) => fs.readFileSync(path.join(path.dirname(packageJson), file), 'utf8');
  const modules: Record<string, string> = {
    react: packageFile(appRequire.resolve('react/package.json'), 'cjs/react.production.js'),
    scheduler: packageFile(createRequire(reactDom).resolve('scheduler/package.json'), 'cjs/scheduler.production.js'),
    'react-dom': packageFile(reactDom, 'cjs/react-dom.production.js'),
    'react-dom/client': packageFile(reactDom, 'cjs/react-dom-client.production.js'),
  };
  const factories = Object.entries(modules)
    .map(([name, source]) => `${JSON.stringify(name)}: function (module, exports, require) {\n${source}\n}`)
    .join(',\n');
  return (
    `(function () {\nvar factories = {\n${factories}\n}, cache = {};\n` +
    'function require(name) {\n' +
    '  if (!cache[name]) { cache[name] = { exports: {} }; factories[name](cache[name], cache[name].exports, require); }\n' +
    '  return cache[name].exports;\n' +
    '}\n' +
    "window.React = require('react');\nwindow.ReactDOM = Object.assign({}, require('react-dom'), require('react-dom/client'));\n})();"
  );
}

// The Tailwind sheet a react block gets (#427): the fixed utility list in
// src/lib/reactBlockTailwind.ts, compiled by the app's own Tailwind and minified by Lightning
// CSS (Vite's), for the browsers Tailwind v4 supports. Nothing is generated in the frame.
async function reactBlockTailwind(): Promise<string> {
  const compiler = await compileTailwind(tailwindInput(), {
    base: import.meta.dirname,
    loadStylesheet: async (id) => {
      const file = appRequire.resolve(id);
      return { path: file, base: path.dirname(file), content: fs.readFileSync(file, 'utf8') };
    },
  });
  const { code } = transformCss({
    filename: 'react-block-tailwind.css',
    code: Buffer.from(compactGradients(compiler.build([]))),
    minify: true,
    targets: { chrome: 111 << 16, firefox: 128 << 16, safari: (16 << 16) | (4 << 8) },
  });
  return mergeRules(code.toString());
}

// A library a react block may import (#427), as the text of one classic script that sets the
// global `name`. Bundled by Rolldown, Vite's own bundler, on the frame's React: the library's
// `react` and `react-dom` are window.React and window.ReactDOM, never a second copy.
const FRAME_GLOBALS: Record<string, string> = { react: 'React', 'react-dom': 'ReactDOM' };
async function reactBlockLibrary(entry: string, name: string): Promise<string> {
  const bundle = await rolldown({
    input: 'entry',
    platform: 'browser',
    // lucide-react marks its modules "use client", which means nothing in a classic script.
    checks: { moduleLevelDirective: false },
    transform: { define: { 'process.env.NODE_ENV': '"production"' } },
    plugins: [
      {
        name: 'react-block-library',
        resolveId: (id) => (id === 'entry' || Object.hasOwn(FRAME_GLOBALS, id) ? `\0${id}` : null),
        load: (id) => (id === '\0entry' ? entry : id.startsWith('\0') ? `module.exports = window.${FRAME_GLOBALS[id.slice(1)]};` : null),
      },
    ],
  });
  try {
    // Named: a default export (lodash-es, papaparse) is the global's `default`, as `import _ from …` reads it.
    // No Symbol.toStringTag on the global: lodash-es declares a top-level `Symbol`, which the
    // tag's `Symbol.toStringTag` would read before it is set, and throw.
    const { output } = await bundle.generate({ format: 'iife', name, exports: 'named', generatedCode: { symbols: false }, minify: true });
    return output[0].code;
  } finally {
    await bundle.close();
  }
}

// The script of the library a react block imports as `module`, setting its global in
// REACT_BLOCK_LIBRARIES. Its entry is the package itself unless given.
const library = (module: ReactBlockLibrary, entry = `export * from '${module}';`) => () => reactBlockLibrary(entry, REACT_BLOCK_LIBRARIES[module]);
const srcModule = (file: string) => JSON.stringify(path.resolve(import.meta.dirname, file));

// A react block's page, as virtual modules: each is imported lazily, and a library only for
// a block that imports it.
const REACT_BLOCK_PIECES: Record<string, () => string | Promise<string>> = {
  'virtual:react-block-runtime': reactBlockRuntime,
  'virtual:react-block-tailwind': reactBlockTailwind,
  'virtual:react-block-lucide': library('lucide-react'),
  // Recharts with Journal's chart colours as its defaults.
  'virtual:react-block-recharts': library('recharts', `export * from ${srcModule('src/lib/reactBlockRecharts.ts')};`),
  // #558. lodash-es and papaparse also have a default export (`import _ from 'lodash'`).
  'virtual:react-block-d3': library('d3'),
  'virtual:react-block-three': library('three'),
  'virtual:react-block-lodash': library('lodash-es', "export * from 'lodash-es'; export { default } from 'lodash-es';"),
  'virtual:react-block-mathjs': library('mathjs'),
  'virtual:react-block-papaparse': library('papaparse', "export { default, parse, unparse } from 'papaparse';"),
  // Button, Card, Tabs and the rest, in Journal's theme.
  'virtual:react-block-ui': library('journal-ui', `export * from ${srcModule('src/lib/reactBlockUi.tsx')};`),
};
const reactBlockPieces: Plugin = {
  name: 'react-block-pieces',
  resolveId: (id) => (Object.hasOwn(REACT_BLOCK_PIECES, id) ? `\0${id}` : null),
  async load(id) {
    const build = id.startsWith('\0') && Object.hasOwn(REACT_BLOCK_PIECES, id.slice(1)) ? REACT_BLOCK_PIECES[id.slice(1)] : null;
    return build ? `export default ${JSON.stringify(await build())};` : null;
  },
};

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
  },
  plugins: [
    restorePgliteProcessGuard,
    reactBlockPieces,
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
          // Mermaid runtime (see manualChunks) — loaded only when a mermaid code
          // block is previewed, cached on first use by the mermaid-runtime route
          // in sw.ts.
          '**/mermaid-*.js',
          // A react block's runtime, Tailwind sheet and libraries (reactBlockPieces
          // above; Rolldown names a virtual module's chunk `_virtual_<name>`)
          // and its compiler (src/lib/reactBlockCompiler.ts, with sucrase): loaded only when
          // a react block is previewed, cached on first use by the react-block route in
          // sw.ts (#426, #427).
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
    },
  },
  optimizeDeps: {
    exclude: ['@electric-sql/pglite', 'pglite-v4', '@electric-sql/pglite-tools'],
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
          // True for mermaid itself and for modules whose every importer is one
          // (so shared deps such as katex, also used by the editor, stay out).
          const onlyViaMermaid = (moduleId: string, stack: Set<string>): boolean => {
            if (moduleId.includes('/node_modules/mermaid/')) return true;
            const info = getModuleInfo(moduleId);
            if (!info || info.isEntry || stack.has(moduleId) || !moduleId.includes('/node_modules/')) return false;
            if (info.importers.length + info.dynamicImporters.length === 0) return false;
            stack.add(moduleId);
            const only = [...info.importers, ...info.dynamicImporters].every((importer) => onlyViaMermaid(importer, stack));
            stack.delete(moduleId);
            return only;
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
          // Mermaid and the modules only it pulls in (~100 lazy diagram/helper
          // chunks otherwise). One chunk with a stable name so globIgnores and
          // the mermaid-runtime route in sw.ts can match it. Loaded only through
          // the dynamic import in LiveBlockPreview, so it is off the boot path.
          if (onlyViaMermaid(id, new Set())) return 'mermaid';
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
