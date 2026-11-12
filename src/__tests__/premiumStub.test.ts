import { existsSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { hasPremium } from '@premium';

describe('@premium', () => {
  it('is the stub unless the native/ submodule is checked out', () => {
    expect(hasPremium).toBe(existsSync('native/web/index.ts'));
  });
});
