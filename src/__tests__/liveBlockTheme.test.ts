import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRAME_TOKENS, THEME_DEFAULTS } from '@journal/live-blocks/core';

// @journal/live-blocks draws a block in Journal's look where the host sets no theme variables
// (#1075): its defaults must be the app's own tokens, or a block in another host would look
// different from the same block in Journal.
const CSS = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
function tokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(`\n${selector} {`);
  const body = CSS.slice(start, CSS.indexOf('}', start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
}

describe('THEME_DEFAULTS', () => {
  const light = tokens(':root');
  const themes = { light, dark: { ...light, ...tokens('.dark') } };

  it.each(['light', 'dark'] as const)('should be src/index.css in the %s theme', (scheme) => {
    for (const name of [...FRAME_TOKENS, '--font-sans'] as const) {
      expect(THEME_DEFAULTS[scheme][name], name).toBe(themes[scheme][name]);
    }
  });

  it('should have a value for every frame token and nothing else', () => {
    expect(Object.keys(THEME_DEFAULTS.light).sort()).toEqual([...FRAME_TOKENS, '--font-sans'].sort());
    expect(Object.keys(THEME_DEFAULTS.dark).sort()).toEqual([...FRAME_TOKENS, '--font-sans'].sort());
  });
});
