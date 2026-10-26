/**
 * #848: which owner console fixes the journal drive still needs for share pushes, and that
 * both the app and the MCP app ask for a drive that already has them.
 * #870: the extend-permissions URL that makes both fixes in one tap, and who owns the drive
 * (not needed for the push).
 */
import { describe, it, expect, vi } from 'vitest';
import type { DotYouClient } from '@homebase-id/js-lib/core';

const mocks = vi.hoisted(() => ({ getDrivesByType: vi.fn() }));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@homebase-id/js-lib/core')>()),
    getDrivesByType: mocks.getDrivesByType,
}));

import { JOURNAL_APP_ID, JOURNAL_DRIVE } from '@/lib/homebase/config';
import { journalDriveRequest } from '@/hooks/auth/useYouAuthAuthorization';
import { mcpDriveRequest } from '../../mcp/config';
import { driveNeedsOwner, fetchJournalDriveFacts, missingShareDriveFixes } from '@/lib/homebase/shareNotifications';
import { getJournalDriveFixUrl } from '@/hooks/auth/useMissingPermissions';

const GOOD = { allowSubscriptions: true, attributes: { IsCollaborativeChannel: 'true' }, appId: JOURNAL_APP_ID };

describe('missingShareDriveFixes', () => {
    it('is empty for a drive that has both, with or without a refusal', () => {
        expect(missingShareDriveFixes(GOOD, false)).toEqual([]);
        expect(missingShareDriveFixes({ ...GOOD, appId: JOURNAL_APP_ID.toUpperCase() }, false)).toEqual([]);
    });

    it.each([
        ['subscriptions', { ...GOOD, allowSubscriptions: false }],
        ['attribute', { ...GOOD, attributes: {} }],
        ['attribute', { ...GOOD, attributes: { IsCollaborativeChannel: 'false' } }],
    ])('lists only %s when that is the one thing missing', (fix, drive) => {
        expect(missingShareDriveFixes(drive, false)).toEqual([fix]);
        expect(missingShareDriveFixes(drive, true)).toEqual([fix]);
    });

    it('lists several in the order to do them', () => {
        expect(missingShareDriveFixes({ allowSubscriptions: false, attributes: {} }, false))
            .toEqual(['subscriptions', 'attribute']);
    });

    it('says nothing about facts the host did not serve until a push was refused', () => {
        expect(missingShareDriveFixes(null, false)).toEqual([]);
        expect(missingShareDriveFixes({}, false)).toEqual([]);
        expect(missingShareDriveFixes(null, true)).toEqual(['attribute', 'maybeSubscriptions']);
        expect(missingShareDriveFixes({ allowSubscriptions: true }, true)).toEqual(['attribute']);
    });

    // The live states on a demo identity: an app token reads the attribute and the owner, never subscriptions.
    const SYSTEM_APP = 'ac126e09000000000000000000000000';
    const SET = { IsCollaborativeChannel: 'true' };
    it.each([
        ['set, owned by System (subscriptions on or off)', { attributes: SET, appId: SYSTEM_APP }, false, []],
        ['attribute removed', { attributes: {}, appId: SYSTEM_APP }, false, ['attribute']],
        ['attribute removed, push refused', { attributes: {}, appId: SYSTEM_APP }, true, ['attribute', 'maybeSubscriptions']],
        ['subscriptions off, push refused', { attributes: SET, appId: SYSTEM_APP }, true, ['subscriptions']],
        ['set, owned by Journal', { attributes: SET, appId: JOURNAL_APP_ID }, false, []],
    ])('as an app token sees it: %s', (_state, drive, refused, fixes) => {
        expect(missingShareDriveFixes(drive, refused)).toEqual(fixes);
    });

    it('shows every step when a push was refused although every fact looks right', () => {
        expect(missingShareDriveFixes(GOOD, true)).toEqual(['subscriptions', 'attribute']);
    });
});

describe('driveNeedsOwner', () => {
    it('is true only when the host names another app (or none) as the owner', () => {
        expect(driveNeedsOwner({ ...GOOD, appId: 'ac126e09000000000000000000000000' })).toBe(true);
        expect(driveNeedsOwner({ ...GOOD, appId: null })).toBe(true);
        expect(driveNeedsOwner(GOOD)).toBe(false);
        expect(driveNeedsOwner({ ...GOOD, appId: JOURNAL_APP_ID.toUpperCase() })).toBe(false);
    });

    it('is false when the owner is unknown', () => {
        expect(driveNeedsOwner(null)).toBe(false);
        expect(driveNeedsOwner({})).toBe(false);
    });
});

describe('getJournalDriveFixUrl (#870)', () => {
    const url = new URL(getJournalDriveFixUrl('https://me.id', 'https://journal.test/'));
    const drives = JSON.parse(url.searchParams.get('d')!);

    it('opens the extend-permissions page and comes back to the given page', () => {
        expect(url.origin + url.pathname).toBe('https://me.id/owner/appupdate');
        expect(url.searchParams.get('appId')).toBe(JOURNAL_APP_ID);
        expect(url.searchParams.get('return')).toBe('https://journal.test/');
    });

    it('asks for the journal drive with its attribute and subscriptions, and nothing else', () => {
        expect(drives).toHaveLength(1);
        expect(drives[0]).toMatchObject({
            a: JOURNAL_DRIVE.alias,
            t: JOURNAL_DRIVE.type,
            p: journalDriveRequest.permissions.reduce((a, b) => a + b, 0),
            s: true,
            at: JSON.stringify({ IsCollaborativeChannel: 'true' }),
        });
        expect(url.searchParams.has('p')).toBe(false);
        expect(url.searchParams.has('cd')).toBe(false);
    });
});

describe('fetchJournalDriveFacts', () => {
    const client = {} as DotYouClient;

    it('returns the journal drive from the app token metadata listing', async () => {
        const other = { targetDriveInfo: { alias: 'aa', type: JOURNAL_DRIVE.type }, allowSubscriptions: false };
        const journal = { targetDriveInfo: JOURNAL_DRIVE, ...GOOD };
        mocks.getDrivesByType.mockResolvedValue({ results: [other, journal] });
        expect(await fetchJournalDriveFacts(client)).toBe(journal);
    });

    it('is null when the drive is not listed or the call fails', async () => {
        mocks.getDrivesByType.mockResolvedValueOnce({ results: [] });
        expect(await fetchJournalDriveFacts(client)).toBeNull();
        mocks.getDrivesByType.mockRejectedValueOnce(new Error('403'));
        expect(await fetchJournalDriveFacts(client)).toBeNull();
    });
});

describe('the drive requests', () => {
    it('both ask for subscriptions and the IsCollaborativeChannel attribute', () => {
        for (const request of [journalDriveRequest, mcpDriveRequest]) {
            expect(request.allowSubscriptions).toBe(true);
            expect(request.attributes).toEqual({ IsCollaborativeChannel: 'true' });
        }
    });
});
