import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { duration, ease, transitions } from '@/lib/motion';

// The motion tokens (#857) live twice: CSS custom properties in src/index.css :root and
// src/lib/motion.ts for framer-motion. This keeps them equal.
const css = readFileSync('src/index.css', 'utf8');
const block = css.match(/:root \{([^}]*--ease-standard[^}]*)\}/)?.[1] ?? '';
const tokens = Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

describe('motion tokens', () => {
  it('index.css and motion.ts hold the same curves', () => {
    for (const [name, points] of Object.entries(ease)) {
      expect(tokens[`ease-${name}`], name).toBe(`cubic-bezier(${points.join(', ')})`);
    }
  });

  it('index.css and motion.ts hold the same durations', () => {
    for (const [name, seconds] of Object.entries(duration)) {
      expect(tokens[`duration-${kebab(name)}`], name).toBe(`${Math.round(seconds * 1000)}ms`);
    }
  });

  it('index.css has no motion token that motion.ts lacks', () => {
    const names = [...Object.keys(ease).map((n) => `ease-${n}`), ...Object.keys(duration).map((n) => `duration-${kebab(n)}`)];
    expect(Object.keys(tokens).sort()).toEqual(names.sort());
  });

  it('the transitions use the tokens', () => {
    expect(transitions.push).toEqual({ duration: duration.push, ease: ease.standard });
    expect(transitions.sheet).toMatchObject({ type: 'spring', duration: duration.sheet });
    expect(transitions.sheetExit).toEqual({ duration: duration.sheetExit, ease: ease.exit });
    expect(transitions.fade).toEqual({ duration: duration.fade, ease: ease.standard });
    expect(transitions.press).toEqual({ duration: duration.press, ease: ease.standard });
  });
});
