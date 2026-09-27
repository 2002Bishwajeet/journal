/**
 * Homebase requires an app to name its own slug at registration (and every drive
 * request to name its slugs). Slugs are permanent, so pin the rules and the wiring.
 */
import { describe, it, expect } from 'vitest';
import { getRegistrationParams, createEccPair } from '@homebase-id/js-lib/auth';
import { JOURNAL_APP_ID, JOURNAL_APP_NAME, JOURNAL_APP_SLUG, CONTACT_TARGET_DRIVE_REQUEST } from '@/lib/homebase/config';
import { journalDriveRequest } from '@/hooks/auth/useYouAuthAuthorization';

const SLUG = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const RESERVED = ['chat', 'contacts', 'email', 'location', 'feed', 'homepage', 'recovery', 'system',
    'moments', 'webdrop', 'vault', 'community', 'photo', 'social-sync', 'lists'];

describe('Homebase app slug', () => {
    it('is a valid, unreserved slug', () => {
        expect(JOURNAL_APP_SLUG).toMatch(SLUG);
        expect(JOURNAL_APP_SLUG.length).toBeLessThanOrEqual(14);
        expect(RESERVED).not.toContain(JOURNAL_APP_SLUG);
    });

    it('sends the app and drive slugs in the registration params', async () => {
        const eccKey = await createEccPair();
        const params = await getRegistrationParams(
            'https://example.com/auth/finalize', JOURNAL_APP_NAME, JOURNAL_APP_ID, JOURNAL_APP_SLUG,
            undefined, undefined, [journalDriveRequest], [journalDriveRequest], undefined, eccKey.publicKey,
        );
        const request = JSON.parse(params.permission_request);
        expect(request.as).toBe(JOURNAL_APP_SLUG);
        expect(JSON.parse(request.d)[0]).toMatchObject({ ds: 'notes', ts: 'notes' });
    });

    it('names slugs on every drive request', () => {
        for (const d of [journalDriveRequest, CONTACT_TARGET_DRIVE_REQUEST]) {
            expect(d.driveSlug).toMatch(SLUG);
            expect(d.driveTypeSlug).toMatch(SLUG);
        }
    });
});
