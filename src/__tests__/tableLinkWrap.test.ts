import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// #1384: a bare URL in a table cell has no break point, so its whole length is the
// column's minimum width and the table grows past the note column. The editor and the
// share page use the same `.prose` rules (#447), so one rule fixes both.
const css = readFileSync('src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const declarations = (selector: string) => {
  const match = css.match(new RegExp(`${selector.replace(/[.\s]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? '';
};

describe('links in table cells', () => {
  it('may break anywhere, in header and body cells', () => {
    const rule = css.match(/\.prose th a,\s*\.prose td a\s*\{([^}]*)\}/);
    expect(rule?.[1]).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('leave ordinary words in a cell unbroken', () => {
    expect(declarations('.prose th, .prose td')).not.toMatch(/overflow-wrap|word-break/);
  });
});
