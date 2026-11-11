/**
 * The pieces of a react or mermaid block's page that are text built at build time, as the
 * `virtual:react-block-*` modules src/LiveBlockPreview.tsx and src/reactBlockCompiler.ts import
 * lazily. Both the package's own build (vite.config.ts here) and Journal's (the root
 * vite.config.ts) bundle the source with this plugin; a consumer of the published package gets
 * each piece as a chunk of its own and needs no plugin.
 */
import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { transform as transformCss } from 'lightningcss';
import { rolldown } from 'rolldown';
import { compile as compileTailwind } from 'tailwindcss';
import type { Plugin } from 'vite';
import { compactGradients, mergeRules, tailwindInput } from '../src/reactBlockTailwind.ts';
import { REACT_BLOCK_LIBRARIES, type ReactBlockLibrary } from '../src/reactBlockLibraries.ts';

// The React a `react` live block runs on (#426): the installed react and react-dom/client as
// the text of one classic script, which sets window.React and window.ReactDOM (react-dom/client
// with react-dom's own exports, such as the createPortal Recharts uses, #427). A block's
// sandboxed frame cannot load the host's modules, so the host inlines this text into the frame's
// srcdoc. Made from the packages' CommonJS production files and a tiny require(), in this
// build: no second build tool, no generated file.
const packageRequire = createRequire(import.meta.url);
function reactBlockRuntime(): string {
  // Each file is read next to its package.json: the packages' `exports` hide their cjs/ files.
  const reactDom = packageRequire.resolve('react-dom/package.json');
  const packageFile = (packageJson: string, file: string) => fs.readFileSync(path.join(path.dirname(packageJson), file), 'utf8');
  const modules: Record<string, string> = {
    react: packageFile(packageRequire.resolve('react/package.json'), 'cjs/react.production.js'),
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
// src/reactBlockTailwind.ts, compiled by Tailwind and minified by Lightning CSS (Vite's), for
// the browsers Tailwind v4 supports. Nothing is generated in the frame.
async function reactBlockTailwind(): Promise<string> {
  const compiler = await compileTailwind(tailwindInput(), {
    base: import.meta.dirname,
    loadStylesheet: async (id) => {
      const file = packageRequire.resolve(id);
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

// A mermaid block's script (#946): mermaid's own prebuilt bundle, which sets window.mermaid and
// holds every diagram type, and the note's font, which a sandboxed frame cannot load from the
// host. Mermaid has to measure its labels in the font it draws them in.
function mermaidBlockRuntime(): string {
  const mermaid = fs.readFileSync(packageRequire.resolve('mermaid/dist/mermaid.min.js'), 'utf8');
  const inter = fs.readFileSync(packageRequire.resolve('@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64');
  return `${mermaid}\n;document.fonts.add(new FontFace('Inter Variable', 'url(data:font/woff2;base64,${inter})', { weight: '100 900' }));`;
}

// The script of the library a react block imports as `module`, setting its global in
// REACT_BLOCK_LIBRARIES. Its entry is the package itself unless given.
const library = (module: ReactBlockLibrary, entry = `export * from '${module}';`) => () => reactBlockLibrary(entry, REACT_BLOCK_LIBRARIES[module]);
const srcModule = (file: string) => JSON.stringify(path.resolve(import.meta.dirname, '../src', file));

// A react block's page, as virtual modules: each is imported lazily, and a library only for
// a block that imports it. A mermaid block's runtime goes the same way.
const REACT_BLOCK_PIECES: Record<string, () => string | Promise<string>> = {
  'virtual:react-block-mermaid': mermaidBlockRuntime,
  'virtual:react-block-runtime': reactBlockRuntime,
  'virtual:react-block-tailwind': reactBlockTailwind,
  // Tailwind's theme, for the compiler that builds a block's own classes in the host (#559).
  'virtual:react-block-tailwind-theme': () => fs.readFileSync(packageRequire.resolve('tailwindcss/theme.css'), 'utf8'),
  'virtual:react-block-lucide': library('lucide-react'),
  // Recharts with Journal's chart colours as its defaults.
  'virtual:react-block-recharts': library('recharts', `export * from ${srcModule('reactBlockRecharts.ts')};`),
  // #558. lodash-es and papaparse also have a default export (`import _ from 'lodash'`).
  'virtual:react-block-d3': library('d3'),
  'virtual:react-block-three': library('three'),
  'virtual:react-block-lodash': library('lodash-es', "export * from 'lodash-es'; export { default } from 'lodash-es';"),
  'virtual:react-block-mathjs': library('mathjs'),
  'virtual:react-block-papaparse': library('papaparse', "export { default, parse, unparse } from 'papaparse';"),
  // Button, Card, Tabs and the rest, in Journal's theme.
  'virtual:react-block-ui': library('journal-ui', `export * from ${srcModule('reactBlockUi.tsx')};`),
};

/** The Vite plugin that serves each `virtual:react-block-*` module as `export default "<its text>"`. */
export function reactBlockPieces(): Plugin {
  return {
    name: 'react-block-pieces',
    resolveId: (id) => (Object.hasOwn(REACT_BLOCK_PIECES, id) ? `\0${id}` : null),
    async load(id) {
      const build = id.startsWith('\0') && Object.hasOwn(REACT_BLOCK_PIECES, id.slice(1)) ? REACT_BLOCK_PIECES[id.slice(1)] : null;
      return build ? `export default ${JSON.stringify(await build())};` : null;
    },
  };
}
