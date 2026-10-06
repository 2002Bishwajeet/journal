import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRAME_TOKENS } from '@/lib/liveBlocks';
import {
  HUE_INKS,
  INK_SHADES,
  NEUTRALS,
  SHADES,
  TAILWIND_UTILITIES,
  compactGradients,
  mergeRules,
  paletteToken,
  tailwindInput,
  type PaletteName,
} from '@/lib/reactBlockTailwind';

// #427: a react block's Tailwind sheet is drawn in Journal's theme. vite.config.ts compiles
// tailwindInput() at build time; the e2e spec e2e/editor/live-react.spec.ts checks the
// compiled sheet in the frame.

const PALETTE: PaletteName[] = [...NEUTRALS, ...(Object.keys(HUE_INKS) as (keyof typeof HUE_INKS)[])];

describe('paletteToken', () => {
  it('should draw the grays in the neutral tokens', () => {
    for (const name of NEUTRALS) {
      expect([50, 100, 200].map((shade) => paletteToken(name, shade as 50))).toEqual(['--muted', '--muted', '--muted']);
      expect(paletteToken(name, 300)).toBe('--border');
      expect([400, 500, 600].map((shade) => paletteToken(name, shade as 400))).toEqual(Array(3).fill('--muted-foreground'));
      expect([700, 800, 900, 950].map((shade) => paletteToken(name, shade as 700))).toEqual(Array(4).fill('--foreground'));
    }
  });

  it('should draw every hue in one chart ink, washed for the light shades and deepened for the dark ones', () => {
    expect(paletteToken('blue', 500)).toBe('--chart-5');
    expect(paletteToken('purple', 400)).toBe('--chart-5');
    expect(paletteToken('green', 50)).toBe('--chart-3-50');
    expect(paletteToken('red', 900)).toBe('--chart-2-900');
    for (const name of Object.keys(HUE_INKS) as (keyof typeof HUE_INKS)[]) {
      for (const shade of SHADES) expect(paletteToken(name, shade)).toBe(INK_SHADES[shade] ? `${HUE_INKS[name]}-${shade}` : HUE_INKS[name]);
    }
  });

  it('should use every chart ink but --chart-1, which is nearly the text colour', () => {
    expect(new Set(Object.values(HUE_INKS))).toEqual(new Set(['--chart-2', '--chart-3', '--chart-4', '--chart-5']));
  });
});

describe('tailwindInput', () => {
  const input = tailwindInput();

  it("should take Tailwind's theme and utilities, and leave out its preflight", () => {
    expect(input).toContain("@import 'tailwindcss/theme.css';");
    expect(input).toContain('@tailwind utilities;');
    expect(input).not.toMatch(/preflight|@import 'tailwindcss'|@tailwind base/);
  });

  it('should map the theme names, white and black, and every palette colour to frame variables', () => {
    expect(input).toContain('--color-muted: var(--muted);');
    expect(input).toContain('--color-card: var(--card);');
    expect(input).toContain('--color-white: var(--background);');
    expect(input).toContain('--color-black: var(--foreground);');
    expect(input).toContain('--color-blue-500: var(--chart-5);');
    expect(input).toContain('--color-gray-600: var(--muted-foreground);');
    expect(input).toContain('--color-purple-400: var(--chart-5);');
    // Every theme variable a utility names is one the frame gets.
    const frameTokens = new Set<string>([...FRAME_TOKENS, '--font-sans']);
    const named = [...input.matchAll(/--color-[\w-]+: var\((--[\w-]+)\)/g)].map((match) => match[1]);
    for (const token of named) expect(frameTokens.has(token) || /^--chart-\d-\d+$/.test(token), token).toBe(true);
  });

  it('should declare each washed or deepened ink once, as a mix of the theme variables', () => {
    expect(input).toContain('--chart-2-50:color-mix(in srgb,var(--chart-2) 12%,var(--background));');
    expect(input).toContain('--chart-5-950:color-mix(in srgb,var(--chart-5) 35%,var(--foreground));');
    expect(input).not.toContain('--chart-1-');
  });

  it("should give font-sans the note's font and the larger radii the app's", () => {
    expect(input).toContain('--font-sans: var(--font-sans);');
    expect(input).toContain('--radius-md: calc(var(--radius) - 2px);');
    expect(input).toContain('--radius-2xl: calc(var(--radius) + 4px);');
  });

  it('should keep the theme inline, so the sheet declares no variable of the frame', () => {
    expect(input).toContain('@theme inline reference {');
    expect(input.match(/@theme/g)).toHaveLength(1);
  });

  it('should draw a bare border and ring in the theme colours', () => {
    expect(input).toContain('*,::before,::after{border-color:var(--border);--tw-ring-color:var(--ring)}');
  });
});

describe('TAILWIND_UTILITIES', () => {
  const utilities = new Set(TAILWIND_UTILITIES);

  it('should cover the families an artifact uses, with the theme names and raw palette names', () => {
    for (const utility of [
      'flex', 'grid', 'grid-cols-3', 'gap-4', 'space-y-2', 'items-center', 'justify-between', 'flex-wrap',
      'p-4', 'px-6', 'mt-2', 'mx-auto', 'w-full', 'h-8', 'size-4', 'max-w-md',
      'text-sm', 'font-semibold', 'leading-tight', 'tracking-tight', 'text-center', 'truncate', 'font-sans', 'font-mono',
      'bg-muted', 'text-muted-foreground', 'border', 'rounded-md', 'bg-card', 'text-primary',
      'bg-blue-500', 'text-gray-600', 'border-gray-200', 'from-purple-400', 'via-pink-500', 'to-blue-600', 'bg-gradient-to-r',
      'fill-current', 'stroke-chart-2', 'ring-2', 'ring-ring', 'divide-y', 'divide-border',
      'opacity-50', 'shadow-sm', 'hover:bg-blue-600', 'hover:text-foreground', 'focus-visible:ring-2', 'sm:grid-cols-2',
    ]) {
      expect(utilities.has(utility), utility).toBe(true);
    }
  });

  it('should have no breakpoint but sm and no dark variant', () => {
    expect(TAILWIND_UTILITIES.filter((utility) => /^(md|lg|xl|2xl|dark):/.test(utility))).toEqual([]);
  });

  it('should list each utility once', () => {
    expect(utilities.size).toBe(TAILWIND_UTILITIES.length);
  });
});

describe('compactGradients', () => {
  // Tailwind's output for one gradient, as compile().build() prints it.
  const TAILWIND = [
    '.bg-gradient-to-r {',
    '  --tw-gradient-position: to right in oklab;',
    '  background-image: linear-gradient(var(--tw-gradient-stops));',
    '}',
    '.from-blue-500 {',
    '  --tw-gradient-from: var(--chart-1);',
    '  --tw-gradient-stops: var(--tw-gradient-via-stops, var(--tw-gradient-position), var(--tw-gradient-from) var(--tw-gradient-from-position), var(--tw-gradient-to) var(--tw-gradient-to-position));',
    '}',
    '.via-pink-500 {',
    '  --tw-gradient-via: var(--chart-2);',
    '  --tw-gradient-via-stops: var(--tw-gradient-position), var(--tw-gradient-from) var(--tw-gradient-from-position), var(--tw-gradient-via) var(--tw-gradient-via-position), var(--tw-gradient-to) var(--tw-gradient-to-position);',
    '  --tw-gradient-stops: var(--tw-gradient-via-stops);',
    '}',
    '@property --tw-gradient-stops {',
    '  syntax: "*";',
    '}',
  ].join('\n');
  const css = compactGradients(TAILWIND);

  it('should keep only the colour in each stop rule', () => {
    const rule = (selector: string) => css.slice(css.indexOf(`${selector} {`), css.indexOf('}', css.indexOf(`${selector} {`)));
    expect(rule('.from-blue-500').replace(/\s+/g, ' ')).toBe('.from-blue-500 { --tw-gradient-from: var(--chart-1); ');
    expect(rule('.via-pink-500').replace(/\s+/g, ' ')).toBe('.via-pink-500 { --tw-gradient-via: var(--chart-2); ');
    expect(rule('.bg-gradient-to-r')).toContain('background-image: linear-gradient(var(--tw-gradient-stops));');
    expect(css).toContain('@property --tw-gradient-stops {');
  });

  it("should set Tailwind's list of stops once, on every gradient direction, and the via list on a via class", () => {
    expect(css).toMatch(/\.bg-gradient-to-r,[^{]*\.bg-linear-to-r[^{]*\{--tw-gradient-stops:var\(--tw-gradient-via-stops,var\(--tw-gradient-position\),var\(--tw-gradient-from\) var\(--tw-gradient-from-position\),var\(--tw-gradient-to\) var\(--tw-gradient-to-position\)\)\}/);
    expect(css).toContain(':where([class^="via-"],[class*=" via-"]){--tw-gradient-via-stops:var(--tw-gradient-position),var(--tw-gradient-from) var(--tw-gradient-from-position),var(--tw-gradient-via) var(--tw-gradient-via-position),var(--tw-gradient-to) var(--tw-gradient-to-position)}');
  });
});

describe('mergeRules', () => {
  it('should merge each class rule into the first one with the same declarations', () => {
    expect(mergeRules('.bg-blue-500{background-color:var(--chart-1)}.bg-muted{background-color:var(--muted)}.bg-indigo-500{background-color:var(--chart-1)}')).toBe(
      '.bg-blue-500,.bg-indigo-500{background-color:var(--chart-1)}.bg-muted{background-color:var(--muted)}',
    );
  });

  it('should merge inside a media rule, and never across its edge', () => {
    expect(mergeRules('.a{color:red}@media (hover:hover){.hover\\:a:hover{color:red}.hover\\:b:hover{color:red}}')).toBe(
      '.a{color:red}@media (hover:hover){.hover\\:a:hover,.hover\\:b:hover{color:red}}',
    );
  });

  it('should leave any other rule where it is', () => {
    const css = ':root{--x:1}*,:before{border-color:red}:where(.divide-y>:not(:last-child)){color:red}.a{color:red}@property --y{syntax:"*"}.b{color:red}';
    expect(mergeRules(css)).toBe(':root{--x:1}*,:before{border-color:red}:where(.divide-y>:not(:last-child)){color:red}.a,.b{color:red}@property --y{syntax:"*"}');
  });
});

// The frame's theme tokens (src/index.css) and WCAG contrast, as in chartPalette.test.ts.
const CSS = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
function tokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(`\n${selector} {`);
  const body = CSS.slice(start, CSS.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(([, name, value]) => [name, value]));
}
type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
const luminance = (c: RGB) => {
  const [r, g, b] = c.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
])('the palette mapping, %s theme', (_theme, selector) => {
  const theme = tokens(selector);
  /** A variable's colour, as `color-mix(in srgb, …)` computes the washed and deepened inks. */
  const colour = (token: string): RGB => {
    const mixed = token.match(/^(--chart-\d)-(\d+)$/);
    if (!mixed) return rgb(theme[token]);
    const { percent, into } = INK_SHADES[Number(mixed[2]) as keyof typeof INK_SHADES]!;
    const [ink, other] = [rgb(theme[mixed[1]]), rgb(theme[into])];
    return ink.map((value, i) => (value * percent + other[i] * (100 - percent)) / 100) as RGB;
  };
  const background = colour('--background');

  it('should give text in every shade from 400 up a contrast of at least 3:1 on the background', () => {
    for (const name of PALETTE) {
      for (const shade of SHADES.filter((shade) => shade >= 400)) {
        expect(contrast(colour(paletteToken(name, shade)), background), `${name}-${shade}`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('should give text in the light shades a contrast of at least 3:1 on the dark shades of the same colour', () => {
    for (const name of PALETTE) {
      for (const light of [50, 100, 200] as const) {
        for (const dark of [700, 800, 900, 950] as const) {
          expect(contrast(colour(paletteToken(name, light)), colour(paletteToken(name, dark))), `${name}-${light} on ${name}-${dark}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
  });

  it('should give white text a contrast of at least 3:1 on every hue', () => {
    for (const name of Object.keys(HUE_INKS) as (keyof typeof HUE_INKS)[]) {
      expect(contrast(background, colour(paletteToken(name, 500))), `white on ${name}-500`).toBeGreaterThanOrEqual(3);
    }
  });
});
