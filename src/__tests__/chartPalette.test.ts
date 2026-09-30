import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #430: the chart palette (`--chart-1` … `--chart-5` in src/index.css) must read on the
// theme's background, be told apart at a glance (also with deuteranopia), and stay muted.

const CSS = readFileSync(new URL('../index.css', import.meta.url), 'utf8');

/** The `--name: #RRGGBB` declarations of the first rule whose selector is `selector`. */
function tokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(`\n${selector} {`);
  expect(start, `${selector} rule in src/index.css`).toBeGreaterThanOrEqual(0);
  const body = CSS.slice(start, CSS.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})\b/g)].map(([, name, value]) => [name, value]));
}

type RGB = [number, number, number];
const rgb = (hex: string): RGB => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as RGB;
const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const luminance = (c: RGB) => {
  const [r, g, b] = c.map(toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG contrast ratio. */
const contrast = (a: RGB, b: RGB) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
/** HSL saturation, 0 to 1. */
const saturation = (c: RGB) => {
  const max = Math.max(...c);
  const min = Math.min(...c);
  const lightness = (max + min) / 2;
  return max === min ? 0 : (max - min) / (1 - Math.abs(2 * lightness - 1));
};
/** CIELAB under D65. */
const lab = (c: RGB): RGB => {
  const [r, g, b] = c.map(toLinear);
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const fy = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const fz = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};
/** CIEDE2000 colour difference (Sharma, Wu and Dalal 2005). */
function deltaE2000([L1, a1, b1]: RGB, [L2, a2, b2]: RGB): number {
  const rad = Math.PI / 180;
  const hue = (b: number, a: number) => (b === 0 && a === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const Cbar = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const [a1p, a2p] = [a1 * (1 + G), a2 * (1 + G)];
  const [C1p, C2p] = [Math.hypot(a1p, b1), Math.hypot(a2p, b2)];
  const [h1p, h2p] = [hue(b1, a1p), hue(b2, a2p)];
  let dhp = 0;
  if (C1p * C2p !== 0) dhp = h2p - h1p > 180 ? h2p - h1p - 360 : h2p - h1p < -180 ? h2p - h1p + 360 : h2p - h1p;
  const dL = L2 - L1;
  const dC = C2p - C1p;
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbar = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;
  let hbar = h1p + h2p;
  if (C1p * C2p !== 0) hbar = Math.abs(h1p - h2p) <= 180 ? hbar / 2 : hbar < 360 ? (hbar + 360) / 2 : (hbar - 360) / 2;
  const T = 1 - 0.17 * Math.cos((hbar - 30) * rad) + 0.24 * Math.cos(2 * hbar * rad) + 0.32 * Math.cos((3 * hbar + 6) * rad) - 0.2 * Math.cos((4 * hbar - 63) * rad);
  const SL = 1 + (0.015 * (Lbar - 50) ** 2) / Math.sqrt(20 + (Lbar - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7)) * Math.sin(60 * Math.exp(-(((hbar - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
// Deuteranopia, severity 1 (Machado, Oliveira and Fernandes 2009), on linear RGB.
const DEUTERANOPIA = [
  [0.367322, 0.860646, -0.227968],
  [0.280085, 0.672501, 0.047413],
  [-0.01182, 0.04294, 0.968881],
];
const deuteranopia = (c: RGB): RGB => {
  const linear = c.map(toLinear);
  return DEUTERANOPIA.map((row) => toSrgb(Math.min(1, Math.max(0, row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2])))) as RGB;
};

const pairs = <T>(xs: T[]) => xs.flatMap((a, i) => xs.slice(i + 1).map((b, j) => [a, b, i + 1, i + j + 2] as const));

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
])('the chart palette, %s theme', (_theme, selector) => {
  const theme = tokens(selector);
  const background = rgb(theme['--background']);
  const chart = [1, 2, 3, 4, 5].map((n) => {
    expect(theme[`--chart-${n}`], `--chart-${n} in ${selector}`).toBeDefined();
    return rgb(theme[`--chart-${n}`]);
  });

  it('should give every colour a contrast of at least 3:1 with the background', () => {
    for (const [i, colour] of chart.entries()) expect(contrast(colour, background), `--chart-${i + 1}`).toBeGreaterThanOrEqual(3);
  });

  it('should keep every pair at least 15 apart in CIEDE2000', () => {
    for (const [a, b, i, j] of pairs(chart)) expect(deltaE2000(lab(a), lab(b)), `--chart-${i} and --chart-${j}`).toBeGreaterThanOrEqual(15);
  });

  it('should keep every pair at least 10 apart in CIEDE2000 under simulated deuteranopia', () => {
    for (const [a, b, i, j] of pairs(chart)) {
      expect(deltaE2000(lab(deuteranopia(a)), lab(deuteranopia(b))), `--chart-${i} and --chart-${j}`).toBeGreaterThanOrEqual(10);
    }
  });

  it('should keep every colour at or below 45% HSL saturation', () => {
    for (const [i, colour] of chart.entries()) expect(saturation(colour), `--chart-${i + 1}`).toBeLessThanOrEqual(0.45);
  });
});

describe('the colour maths of the chart palette test', () => {
  it('should match published CIEDE2000 test pairs', () => {
    // Sharma, Wu and Dalal (2005), table 1, pairs 1 and 17.
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
  });

  it('should compute WCAG contrast and HSL saturation', () => {
    expect(contrast(rgb('#000000'), rgb('#FFFFFF'))).toBeCloseTo(21, 5);
    expect(saturation(rgb('#FF0000'))).toBe(1);
    expect(saturation(rgb('#808080'))).toBe(0);
  });
});
