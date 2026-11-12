import { existsSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { hasPremium } from '@premium';
import { useEntitlement } from '@/lib/premiumStub';

describe('@premium', () => {
  it('is the stub unless the native/ submodule is checked out', () => {
    expect(hasPremium).toBe(existsSync('native/web/index.ts'));
  });
});

describe('premiumStub useEntitlement', () => {
  it('is always unlocked and can edit', async () => {
    const entitlement = useEntitlement();
    expect(entitlement).toMatchObject({ status: 'unlocked', canEdit: true });
    expect(entitlement.unlockedBy).toBeUndefined();
    await expect(entitlement.refresh()).resolves.toBeUndefined();
  });
});
