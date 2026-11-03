import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #892: on a phone a tap applies :hover and it stays, so every hand-written :hover
// rule sits inside @media (hover: hover). Tailwind's hover: variant does this itself.
const css = readFileSync('src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Each style rule's selector with the at-rule preludes around it. */
function rules(source: string): { selector: string; parents: string[] }[] {
  const out: { selector: string; parents: string[] }[] = [];
  const stack: string[] = [];
  let start = 0;
  for (let i = 0; i < source.length; i++) {
    const c = source[i];
    if (c === '{') {
      const prelude = source.slice(start, i).trim();
      if (!prelude.startsWith('@')) out.push({ selector: prelude, parents: [...stack] });
      stack.push(prelude);
      start = i + 1;
    } else if (c === '}') {
      stack.pop();
      start = i + 1;
    } else if (c === ';') {
      start = i + 1;
    }
  }
  return out;
}

describe('hand-written :hover rules', () => {
  it('finds the gated rules (the scanner works)', () => {
    const hovers = rules(css).filter((r) => r.selector.includes(':hover'));
    expect(hovers.map((r) => r.selector)).toContain('.gallery-toolbar > button:hover');
  });

  it('are all inside @media (hover: hover) and (pointer: fine)', () => {
    const ungated = rules(css)
      .filter((r) => r.selector.includes(':hover') && !r.selector.includes('::-webkit-scrollbar'))
      .filter((r) => !r.parents.some((p) => p.startsWith('@media') && p.includes('hover: hover') && p.includes('pointer: fine')))
      .map((r) => r.selector);
    expect(ungated).toEqual([]);
  });

  it('keep the selected layout and keyboard focus styles outside the hover query', () => {
    const outside = rules(css).filter((r) => !r.parents.some((p) => p.includes('hover: hover')));
    expect(outside.map((r) => r.selector)).toContain(".gallery-toolbar > button[aria-pressed='true']");
    expect(outside.map((r) => r.selector)).toContain('.gallery-block:focus-within > .gallery-toolbar');
  });

  it('sets text-size-adjust on html so iOS does not inflate text in landscape', () => {
    expect(css).toMatch(/html \{[^}]*-webkit-text-size-adjust: 100%;[^}]*text-size-adjust: 100%;/);
  });
});
