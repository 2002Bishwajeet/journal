import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs release script, no types
import { NATIVE_VERSION_FILES, readVersion, writeVersion } from '../../scripts/native-version.mjs';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const files = Object.entries(NATIVE_VERSION_FILES as Record<string, RegExp>);

describe('native shell version', () => {
  const { version } = JSON.parse(read('package.json')) as { version: string };

  it.each(files)('%s matches package.json', (file, pattern) => {
    expect(readVersion(read(file), pattern)).toBe(version);
  });

  it.each(files)('rewrites only the app version in %s', (file, pattern) => {
    const text = read(file);
    const bumped = writeVersion(text, pattern, '99.0.0');
    expect(readVersion(bumped, pattern)).toBe('99.0.0');
    expect(bumped.replace('99.0.0', version)).toBe(text);
  });
});
