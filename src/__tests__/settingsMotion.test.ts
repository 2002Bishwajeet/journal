import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const SETTINGS_DIR = path.resolve(import.meta.dirname, '../components/settings');

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(fullPath) : [fullPath];
  });
}

const FORBIDDEN_PATTERNS = [
  'framer-motion',
  'AnimatePresence',
  'transition-all',
  'layoutId',
  'staggerChildren',
  'blur(',
];

describe('Settings motion removal', () => {
  const files = listFiles(SETTINGS_DIR).map((file) => ({
    file,
    content: fs.readFileSync(file, 'utf-8'),
  }));

  it('finds settings files to check', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(FORBIDDEN_PATTERNS)('contains no "%s"', (pattern) => {
    for (const { file, content } of files) {
      expect(content, `${file} still contains "${pattern}"`).not.toContain(pattern);
    }
  });
});
