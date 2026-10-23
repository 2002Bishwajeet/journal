/**
 * #681: odin-core reports `caller.isGrantedConnectedIdentitiesSystemCircle` from the caller's
 * circles, and an app-token caller has none, so the flag is false even when the Journal app has
 * the all connected identities circle. Gating on it kept "Grant Permissions" on screen forever.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SecurityContex } from '@homebase-id/js-lib/core';

const context = vi.hoisted(() => ({ current: undefined as SecurityContex | undefined }));

vi.mock('@/components/auth', () => ({
    useDotYouClientContext: () => ({ getRoot: () => 'https://owner.example.com' }),
}));
vi.mock('@/hooks/securityContext/useSecurityContext', () => ({
    useSecurityContext: () => ({ fetch: { data: context.current } }),
}));

import { useMissingPermissions } from '@/hooks/auth/useMissingPermissions';

const drive = { alias: 'd5f411fa83fd4854a3bd7e974cc9bca9', type: '2612429d1c3f037282b8d42fb2cc0499' };
const driveRequest = { ...drive, driveSlug: 'journal', driveTypeSlug: 'journal', name: 'Journal', description: '', permissions: [1, 2] };

const securityContext = (driveGrants: unknown[], keys: number[]): SecurityContex => ({
    caller: { securityLevel: 'owner', isGrantedConnectedIdentitiesSystemCircle: false },
    permissionContext: { permissionGroups: [{ driveGrants, permissionSet: { keys } }] },
} as unknown as SecurityContex);

const grant = { permissionedDrive: { drive, permission: [1, 2] } };

const useCollaborationCheck = () => useMissingPermissions({
    appId: 'app',
    drives: [driveRequest],
    permissions: [10],
    needsAllConnected: true,
    returnUrl: 'https://journal.test/',
});

describe('useMissingPermissions with needsAllConnected (#681)', () => {
    beforeEach(() => {
        context.current = undefined;
    });

    it('asks for nothing when drives and keys are granted, though the flag reads false', () => {
        context.current = securityContext([grant], [10]);
        expect(useCollaborationCheck()).toBeUndefined();
    });

    it('requests the all connected circles along with a missing permission', () => {
        context.current = securityContext([grant], []);
        const url = new URL(useCollaborationCheck()!);
        expect(url.pathname).toBe('/owner/appupdate');
        expect(JSON.parse(url.searchParams.get('c')!)).toContain('bb2683fa402aff866e771a6495765a15');
    });
});
