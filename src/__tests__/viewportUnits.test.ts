import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// #894: pages outside the app shell use svh, not 100vh, so they are not taller than the visible area on a phone.
// Entries leave this list when #790 and #829 remove their 100vh.
const ALLOWED = new Set(['EditorProvider.tsx', 'ImageLightbox.tsx', 'ImageEditDialog.tsx', 'ShareOutline.tsx']);
const TALL = /(?<![\w-])(?:min-h-screen|h-screen)(?![\w-])|\b100vh\b/;

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return tsxFiles(path);
    return entry.name.endsWith('.tsx') ? [path] : [];
  });
}

describe('viewport units', () => {
  it('no page or component uses min-h-screen, h-screen or 100vh', () => {
    const offenders = ['src/pages', 'src/components']
      .flatMap(tsxFiles)
      .filter((file) => !ALLOWED.has(file.split('/').pop()!))
      .filter((file) => TALL.test(readFileSync(file, 'utf8')));
    expect(offenders).toEqual([]);
  });
});
