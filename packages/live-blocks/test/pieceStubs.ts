import path from 'path';

const STUBS: Record<string, string> = {
  'virtual:react-block-runtime': 'reactBlockRuntime',
  'virtual:react-block-mermaid': 'reactBlockMermaid',
  'virtual:react-block-tailwind': 'reactBlockTailwind',
  'virtual:react-block-tailwind-theme': 'reactBlockTailwindTheme',
  'virtual:react-block-lucide': 'reactBlockLucide',
  'virtual:react-block-recharts': 'reactBlockRecharts',
  'virtual:react-block-d3': 'reactBlockD3',
  'virtual:react-block-three': 'reactBlockThree',
  'virtual:react-block-lodash': 'reactBlockLodash',
  'virtual:react-block-mathjs': 'reactBlockMathjs',
  'virtual:react-block-papaparse': 'reactBlockPapaparse',
  'virtual:react-block-ui': 'reactBlockUi',
};

/**
 * Vitest aliases for the `virtual:react-block-*` modules, which build/pieces.ts builds and
 * vitest does not: each is a stub in test/stubs/. Used by this package's vitest.config.ts
 * and Journal's.
 */
export const pieceStubs = Object.fromEntries(Object.entries(STUBS).map(([id, file]) => [id, path.resolve(import.meta.dirname, 'stubs', `${file}.ts`)]));
