/**
 * The modules a `react` live block can import besides `react` (#427, #558), each with the
 * global its script sets in the frame. vite.config.ts builds each script, and liveBlocks.ts
 * hands a block's `require()` the global. `lodash` is `lodash-es` under its other name.
 * No DOM types here: vite.config.ts imports this too.
 */
export const REACT_BLOCK_LIBRARIES = {
  recharts: 'Recharts',
  'lucide-react': 'LucideReact',
  d3: 'd3',
  three: 'THREE',
  'lodash-es': 'lodash',
  lodash: 'lodash',
  mathjs: 'math',
  papaparse: 'Papa',
  'journal-ui': 'JournalUI',
} as const;
export type ReactBlockLibrary = keyof typeof REACT_BLOCK_LIBRARIES;

/** Every module a react block can import, in order: `react`, then the libraries. */
export const REACT_BLOCK_IMPORTS = ['react', ...Object.keys(REACT_BLOCK_LIBRARIES)];
