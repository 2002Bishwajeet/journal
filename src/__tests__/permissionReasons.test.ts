import { describe, it, expect } from 'vitest';
import { AppPermissionType, ContactConfig } from '@homebase-id/js-lib/network';
import { BASE_PERMISSIONS, COLLABORATION_PERMISSIONS, CONTACT_TARGET_DRIVE_REQUEST } from '@/lib/homebase/config';
import { journalDriveRequest } from '@/hooks/auth/useYouAuthAuthorization';
import {
    describeDrive,
    describePermission,
    isPromptDismissed,
    missingSetKey,
} from '@/lib/homebase/permissionReasons';

describe('permission reasons', () => {
    it('names every permission key Journal requests', () => {
        for (const key of new Set([...BASE_PERMISSIONS, ...COLLABORATION_PERMISSIONS])) {
            expect(describePermission(key).label).not.toBe('Extra access');
        }
        expect(describePermission(AppPermissionType.ReadConnections)).toEqual({
            label: 'See your connections',
            reason: 'Journal uses this to find notes that people share with you.',
        });
    });

    it('falls back to a generic line for an unknown key', () => {
        expect(describePermission(AppPermissionType.ManageFeed)).toEqual({
            label: 'Extra access',
            reason: 'A Journal feature needs this.',
        });
    });

    it('names the journal and contacts drives, and falls back to the drive name', () => {
        expect(describeDrive(journalDriveRequest).label).toBe('Store your notes');
        expect(describeDrive(CONTACT_TARGET_DRIVE_REQUEST).label).toBe('See your contacts');
        const other = { ...journalDriveRequest, alias: 'ffff', name: 'Photos' };
        expect(describeDrive(other)).toEqual({ label: 'Photos', reason: 'A Journal feature needs this.' });
        expect(describeDrive({ ...other, name: ' ' }).label).toBe('Extra storage');
        expect(ContactConfig.ContactTargetDrive.alias).toBe(CONTACT_TARGET_DRIVE_REQUEST.alias);
    });
});

describe('"Not now" dismissal', () => {
    const base = missingSetKey([AppPermissionType.SendPushNotifications, AppPermissionType.ReadConnections], []);

    it('keys a missing set independently of order', () => {
        expect(base).toBe(missingSetKey([AppPermissionType.ReadConnections, AppPermissionType.SendPushNotifications], []));
    });

    it('holds only for the same identity and the same missing set', () => {
        const dismissed = { 'frodo.dotyou.cloud': base };
        expect(isPromptDismissed(dismissed, 'frodo.dotyou.cloud', base)).toBe(true);
        expect(isPromptDismissed(dismissed, 'sam.dotyou.cloud', base)).toBe(false);
        expect(isPromptDismissed(null, 'frodo.dotyou.cloud', base)).toBe(false);
    });

    it('shows the prompt again when the missing set changes', () => {
        const dismissed = { 'frodo.dotyou.cloud': base };
        const morePermissions = missingSetKey([...BASE_PERMISSIONS, AppPermissionType.ReadCircleMembers], []);
        const withDrive = missingSetKey([...BASE_PERMISSIONS], [journalDriveRequest]);
        expect(isPromptDismissed(dismissed, 'frodo.dotyou.cloud', morePermissions)).toBe(false);
        expect(isPromptDismissed(dismissed, 'frodo.dotyou.cloud', withDrive)).toBe(false);
    });
});
