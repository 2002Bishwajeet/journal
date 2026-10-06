/**
 * The Tailwind a `react` live block can use (#427): a fixed list of utilities, drawn in
 * Journal's theme. vite.config.ts compiles them into one stylesheet at build time
 * (`virtual:react-block-tailwind`); nothing is generated in the frame. The colours resolve
 * to the theme variables the frame gets (FRAME_TOKENS in liveBlocks.ts), so the sheet
 * follows the light and dark theme without a `dark:` variant.
 */

/** Theme colour names, as the app's own Tailwind has them (src/index.css `@theme inline`). */
const THEME_COLOURS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
];

/** Tailwind's grays. Each shade is one of the theme's neutral tokens. */
export const NEUTRALS = ['slate', 'gray', 'zinc', 'neutral', 'stone'] as const;

/**
 * Tailwind's hues, each drawn in one chart ink (src/index.css, #430). `--chart-1` is left
 * out: it is nearly the text colour, so a hue drawn in it would read as black or white.
 */
export const HUE_INKS = {
  red: '--chart-2',
  orange: '--chart-2',
  pink: '--chart-2',
  rose: '--chart-2',
  green: '--chart-3',
  emerald: '--chart-3',
  lime: '--chart-3',
  teal: '--chart-3',
  amber: '--chart-4',
  yellow: '--chart-4',
  blue: '--chart-5',
  indigo: '--chart-5',
  sky: '--chart-5',
  cyan: '--chart-5',
  violet: '--chart-5',
  purple: '--chart-5',
  fuchsia: '--chart-5',
} as const;

export const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;
type Shade = (typeof SHADES)[number];
export type PaletteName = (typeof NEUTRALS)[number] | keyof typeof HUE_INKS;

const NEUTRAL_SHADES: Record<Shade, string> = {
  50: '--muted',
  100: '--muted',
  200: '--muted',
  300: '--border',
  // Text in gray-400 is common (secondary labels); `--border` would not read on the background.
  400: '--muted-foreground',
  500: '--muted-foreground',
  600: '--muted-foreground',
  700: '--foreground',
  800: '--foreground',
  900: '--foreground',
  950: '--foreground',
};

/**
 * The light shades of a hue are its ink washed into the background, the dark ones the ink
 * taken towards the text colour (darker in the light theme, lighter in the dark one). The
 * middle shades are the ink itself. The sheet declares each one as a variable, `--chart-2-50`.
 */
export const INK_SHADES: Partial<Record<Shade, { percent: number; into: '--background' | '--foreground' }>> = {
  50: { percent: 12, into: '--background' },
  100: { percent: 20, into: '--background' },
  200: { percent: 32, into: '--background' },
  700: { percent: 80, into: '--foreground' },
  800: { percent: 65, into: '--foreground' },
  900: { percent: 50, into: '--foreground' },
  950: { percent: 35, into: '--foreground' },
};

/** The variable Tailwind's `name`-`shade` is drawn in: `blue-500` → `--chart-5`, `blue-50` → `--chart-5-50`, `gray-100` → `--muted`. */
export function paletteToken(name: PaletteName, shade: Shade): string {
  if (!(name in HUE_INKS)) return NEUTRAL_SHADES[shade];
  const ink = HUE_INKS[name as keyof typeof HUE_INKS];
  return INK_SHADES[shade] ? `${ink}-${shade}` : ink;
}

export const PALETTE_NAMES: PaletteName[] = [...NEUTRALS, ...(Object.keys(HUE_INKS) as (keyof typeof HUE_INKS)[])];
const INKS = [...new Set(Object.values(HUE_INKS))];

/**
 * The stylesheet's input, for Tailwind's compiler: its default theme for sizes, with the
 * colours, fonts, radii and shadows replaced by Journal's. No preflight: the frame keeps
 * its own base and form-control styles (#424). That theme is `inline reference`, so each
 * utility names a frame variable directly and the sheet redeclares none of the frame's.
 */
export function tailwindInput(): string {
  const quiet = '0 1px 2px 0 rgb(0 0 0 / 0.05)';
  const inkShades = INKS.flatMap((ink) =>
    Object.entries(INK_SHADES).map(([shade, mix]) => `${ink}-${shade}:color-mix(in srgb,var(${ink}) ${mix.percent}%,var(${mix.into}));`),
  );
  return [
    "@import 'tailwindcss/theme.css';",
    '@theme inline reference {',
    '--color-*: initial;',
    ...THEME_COLOURS.map((name) => `--color-${name}: var(--${name});`),
    '--color-white: var(--background);',
    '--color-black: var(--foreground);',
    ...PALETTE_NAMES.flatMap((name) => SHADES.map((shade) => `--color-${name}-${shade}: var(${paletteToken(name, shade)});`)),
    // The note's font (buildSrcdoc puts it on :root) and the app's monospace stack.
    '--font-sans: var(--font-sans);',
    '--font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;',
    // The app's radii (src/index.css); the larger ones stay as round as `xl`.
    '--radius: var(--radius);',
    '--radius-xs: calc(var(--radius) - 6px);',
    '--radius-sm: calc(var(--radius) - 4px);',
    '--radius-md: calc(var(--radius) - 2px);',
    '--radius-lg: var(--radius);',
    ...['xl', '2xl', '3xl', '4xl'].map((size) => `--radius-${size}: calc(var(--radius) + 4px);`),
    // The note is flat: a shadow is at most a hairline.
    '--shadow-*: initial;',
    `--shadow: ${quiet};`,
    ...['2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl'].map((size) => `--shadow-${size}: ${quiet};`),
    '}',
    `:root{${inkShades.join('')}}`,
    // A bare `border`, `divide-y` or `ring` is drawn in the theme's colour, as in the app.
    '*,::before,::after{border-color:var(--border);--tw-ring-color:var(--ring)}',
    `@source inline(${JSON.stringify(TAILWIND_UTILITIES.join(' '))});`,
    '@tailwind utilities;',
  ].join('\n');
}

const DIRECTIONS = ['t', 'tr', 'r', 'br', 'b', 'bl', 'l', 'tl'];
const GRADIENTS = DIRECTIONS.flatMap((direction) => [`bg-gradient-to-${direction}`, `bg-linear-to-${direction}`]);
const STOP = (name: string) => `var(--tw-gradient-${name}) var(--tw-gradient-${name}-position)`;

/**
 * Tailwind's compiled sheet, with its gradients made smaller. Every `from-`, `via-` and `to-`
 * rule repeats the same long list of stops, which would make up half the sheet; here each
 * rule keeps only its colour, and the list is set once: on the gradient's direction, which
 * every gradient has, and on any element with a `via-` class.
 */
export function compactGradients(css: string): string {
  const stops = `var(--tw-gradient-via-stops,var(--tw-gradient-position),${STOP('from')},${STOP('to')})`;
  const viaStops = `var(--tw-gradient-position),${STOP('from')},${STOP('via')},${STOP('to')}`;
  return (
    css.replace(/^\s*--tw-gradient-(?:via-)?stops:.*$/gm, '') +
    `\n${GRADIENTS.map((name) => `.${name}`).join(',')}{--tw-gradient-stops:${stops}}` +
    `\n:where([class^="via-"],[class*=" via-"]){--tw-gradient-via-stops:${viaStops}}`
  );
}

/**
 * Minified CSS with each class rule merged into the first rule that has the same
 * declarations, inside @media too: `.bg-blue-500{…}` and `.bg-indigo-500{…}` become one
 * rule. Every palette name repeats the colour of another, so this halves the colour rules.
 * Only rules whose selectors are classes move; a moved rule can only change which of two
 * classes setting one property on the same element wins, which Tailwind leaves undefined too.
 */
export function mergeRules(css: string): string {
  const out: string[] = [];
  const first = new Map<string, number>();
  let i = 0;
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open === -1) {
      out.push(css.slice(i));
      break;
    }
    // The block's end: the brace that balances `open`.
    let close = open;
    for (let depth = 0; ; close++) {
      if (css[close] === '{') depth++;
      else if (css[close] === '}' && --depth === 0) break;
    }
    const prelude = css.slice(i, open);
    const body = css.slice(open + 1, close);
    i = close + 1;
    if (prelude.startsWith('@media')) {
      out.push(`${prelude}{${mergeRules(body)}}`);
    } else if (!body.includes('{') && prelude.split(',').every((selector) => /^\.[^\s>+~[]+$/.test(selector))) {
      const at = first.get(body);
      if (at === undefined) {
        first.set(body, out.length);
        out.push(`${prelude}{${body}}`);
      } else {
        out[at] = out[at].replace('{', `,${prelude}{`);
      }
    } else {
      out.push(`${prelude}{${body}}`);
    }
  }
  return out.join('');
}

const each = (prefixes: string[], values: string[]) => prefixes.flatMap((prefix) => values.map((value) => (value ? `${prefix}-${value}` : prefix)));
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => String(from + i));

const SPACING = ['0', 'px', '0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '5', '6', '7', '8', '9', '10', '11', '12', '14', '16', '20', '24'];
const SIZES = [...SPACING, '28', '32', '36', '40', '44', '48', '56', '64', '72', '80', '96', 'auto', 'full', 'fit', 'min', 'max', '1/2', '1/3', '2/3', '1/4', '3/4'];
const BASE_COLOURS = [...THEME_COLOURS, 'white', 'black', 'transparent', 'current', 'inherit'];
const COLOURS = [...BASE_COLOURS, ...PALETTE_NAMES.flatMap((name) => SHADES.map((shade) => `${name}-${shade}`))];
const NEUTRAL_COLOURS = [...BASE_COLOURS, ...NEUTRALS.flatMap((name) => SHADES.map((shade) => `${name}-${shade}`))];

const DISPLAY = ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'hidden', 'contents'];
const FLEX_DIRECTION = ['flex-row', 'flex-col', 'flex-row-reverse', 'flex-col-reverse'];
const GRID_COLS = each(['grid-cols'], [...range(1, 12), 'none']);
const COL_SPAN = each(['col-span'], [...range(1, 12), 'full']);
const TEXT_SIZES = each(['text'], ['xs', 'sm', 'base', 'lg', 'xl', '2xl', '3xl', '4xl', '5xl', '6xl']);

/** Every utility the sheet has. A block's other classes do nothing. */
export const TAILWIND_UTILITIES: string[] = [
  // Layout
  ...DISPLAY,
  ...FLEX_DIRECTION,
  ...['flex-wrap', 'flex-nowrap', 'flex-1', 'flex-auto', 'flex-none', 'grow', 'grow-0', 'shrink', 'shrink-0'],
  ...each(['items'], ['start', 'center', 'end', 'baseline', 'stretch']),
  ...each(['justify'], ['start', 'center', 'end', 'between', 'around', 'evenly']),
  ...each(['self'], ['auto', 'start', 'center', 'end', 'stretch']),
  ...each(['content'], ['start', 'center', 'end', 'between']),
  ...each(['place-items', 'place-content'], ['center']),
  ...GRID_COLS,
  ...COL_SPAN,
  ...each(['grid-rows'], [...range(1, 6), 'none']),
  ...each(['row-span'], [...range(1, 6), 'full']),
  ...each(['gap', 'gap-x', 'gap-y'], SPACING),
  ...each(['space-x', 'space-y'], ['0', '0.5', '1', '1.5', '2', '2.5', '3', '4', '5', '6', '8', '10', '12']),
  'relative',
  'absolute',
  'sticky',
  ...each(['inset', 'top', 'right', 'bottom', 'left'], ['0', '1', '2', '4', 'auto']),
  ...each(['z'], ['0', '10', '20', '30', '40', '50']),
  ...each(['overflow', 'overflow-x', 'overflow-y'], ['hidden', 'auto', 'visible']),
  ...each(['aspect'], ['square', 'video']),
  ...each(['object'], ['cover', 'contain']),
  // Spacing
  ...each(['p', 'px', 'py', 'pt', 'pr', 'pb', 'pl', 'm', 'mx', 'my', 'mt', 'mr', 'mb', 'ml'], SPACING),
  ...each(['m', 'mx', 'my', 'mt', 'mr', 'mb', 'ml'], ['auto']),
  // Sizing
  ...each(['w', 'h', 'size'], SIZES),
  'w-screen',
  'h-screen',
  ...each(['min-w', 'min-h'], ['0', 'full', 'screen']),
  ...each(['max-w'], ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', '4xl', 'full', 'prose', 'none']),
  ...each(['max-h'], ['full', 'screen', '48', '64', '96']),
  // Typography
  ...TEXT_SIZES,
  ...each(['font'], ['sans', 'mono', 'light', 'normal', 'medium', 'semibold', 'bold', 'extrabold']),
  ...each(['leading'], ['none', 'tight', 'snug', 'normal', 'relaxed', 'loose']),
  ...each(['tracking'], ['tighter', 'tight', 'normal', 'wide', 'wider', 'widest']),
  ...each(['text'], ['left', 'center', 'right', 'justify']),
  ...['truncate', 'text-ellipsis', 'break-words', 'break-all'],
  ...each(['whitespace'], ['normal', 'nowrap', 'pre', 'pre-wrap']),
  ...['uppercase', 'lowercase', 'capitalize', 'normal-case', 'italic', 'not-italic', 'underline', 'line-through', 'no-underline', 'tabular-nums'],
  ...each(['line-clamp'], ['1', '2', '3']),
  // Colours
  // Every colour where blocks use the palette most; the theme's names and the grays elsewhere,
  // which keeps the sheet small (each class is a selector of its own).
  ...each(['bg', 'text', 'border', 'from', 'via', 'to', 'hover:bg'], COLOURS),
  ...each(['ring', 'divide', 'hover:text', 'hover:border'], NEUTRAL_COLOURS),
  ...each(['fill', 'stroke', 'focus-visible:ring', 'focus-visible:border'], BASE_COLOURS),
  ...GRADIENTS,
  // Borders
  ...each(['border', 'border-t', 'border-r', 'border-b', 'border-l', 'border-x', 'border-y'], ['', '0', '2', '4']),
  ...each(['border'], ['solid', 'dashed', 'dotted', 'none']),
  ...each(['divide-x', 'divide-y'], ['', '0', '2']),
  ...each(['rounded', 'rounded-t', 'rounded-r', 'rounded-b', 'rounded-l'], ['', 'none', 'sm', 'md', 'lg', 'xl', '2xl', '3xl', 'full']),
  ...each(['ring', 'focus-visible:ring'], ['', '0', '1', '2', '4']),
  ...['ring-inset', 'outline-none', 'focus-visible:outline-none'],
  // Effects
  ...each(['opacity', 'hover:opacity'], ['0', '5', '10', '20', '25', '30', '40', '50', '60', '70', '75', '80', '90', '95', '100']),
  ...each(['shadow'], ['', 'none', '2xs', 'xs', 'sm', 'md', 'lg', 'xl', '2xl']),
  ...['transition', 'transition-colors', 'transition-all', 'transition-opacity', 'transition-transform'],
  ...each(['duration'], ['100', '200', '300']),
  ...each(['ease'], ['in', 'out', 'in-out']),
  ...['cursor-pointer', 'cursor-default', 'cursor-not-allowed', 'select-none', 'pointer-events-none', 'sr-only'],
  // The frame is about 650px wide: `sm:` is the one breakpoint it can cross.
  ...[...DISPLAY, ...FLEX_DIRECTION, ...GRID_COLS, ...COL_SPAN, ...TEXT_SIZES].map((utility) => `sm:${utility}`),
];
