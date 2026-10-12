import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync('src/index.css', 'utf8');
const rule = (sel: string) =>
  css.match(new RegExp(`^\\.prose ${sel} \\{([^}]*)\\}`, 'm'))?.[1] ?? '';
const size = (sel: string) => {
  const m = rule(sel).match(/font-size:\s*([\d.]+)rem/);
  return m ? Number(m[1]) : NaN;
};

describe('prose heading scale', () => {
  it('has a rule for every level, strictly decreasing from h1 to h6', () => {
    const sizes = [1, 2, 3, 4, 5, 6].map((n) => size(`h${n}`));
    sizes.forEach((s) => expect(s).not.toBeNaN());
    for (let i = 1; i < sizes.length; i++) {
      expect(sizes[i]).toBeLessThan(sizes[i - 1]);
    }
  });

  it('h4 is larger than body text and h5/h6 are distinct from it', () => {
    expect(size('h4')).toBeGreaterThan(1);
    expect(size('h5')).not.toBe(1);
    expect(rule('h6')).toContain('uppercase');
    expect(rule('h6')).toContain('--muted-foreground');
  });
});
