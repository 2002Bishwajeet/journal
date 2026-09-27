/**
 * #246: a fresh identity saw "Missing permissions" right after its first YouAuth consent.
 *
 * The owner console turns the registration's `p` param into the app grant's permission set
 * (`p ? parse(p) : undefined`), so an empty `p` registers the app with a null permission set.
 * odin-core's `PermissionGroup.Redacted()` then returns that group with no drive grants, so
 * `GET /security/context` hides the journal-drive grant the app really holds, and
 * `useMissingPermissions` asks for it again. Captured from the #240 Docker spike (odin-core
 * v0.1.927), app group first:
 *
 *   before /owner/appupdate: {"driveGrants":[],"permissionSet":{"keys":[]}}
 *   after  /owner/appupdate: {"driveGrants":[{..."d5f411fa..."...,"permission":"readWrite"}],
 *                             "permissionSet":{"keys":[]}}
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@homebase-id/js-lib/auth', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/auth')>()),
    saveEccKey: vi.fn(),
}));

import { useYouAuthAuthorization } from '@/hooks/auth/useYouAuthAuthorization';

// Mirrors the owner console's appreg parsing (odin-js owner-app RegisterApp.tsx + util.ts).
const ownerConsolePermissionSet = (p: string | undefined) =>
    p ? { keys: p.split(',').map((s) => parseInt(s)).filter((v) => !!v) } : undefined;

describe('registration permission set (#246)', () => {
    beforeEach(() => {
        vi.stubGlobal('window', { location: { origin: 'https://journal.test' } });
    });

    it('registers with a permission set, so the security context shows the drive grant', async () => {
        const params = await useYouAuthAuthorization().getAuthorizationParameters('https://journal.test/');
        const request = JSON.parse(params.permission_request);

        expect(ownerConsolePermissionSet(request.p)).toEqual({ keys: [] });
    });
});
