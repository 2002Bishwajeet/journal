import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// "Journal+" is only the iOS and Android home-screen name (Info.ios.plist, strings.xml), never user-visible in src/.
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__') return [];
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

describe('app naming', () => {
  it('never shows Journal+ in src/', () => {
    const hits = files('src').filter((f) => /\.(tsx?|md|html|json)$/.test(f) && readFileSync(f, 'utf8').includes('Journal+'));
    expect(hits).toEqual([]);
  });
});
