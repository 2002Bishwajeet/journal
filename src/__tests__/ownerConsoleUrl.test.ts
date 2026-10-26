import { describe, it, expect } from 'vitest';
import { ownerConsoleDriveUrl, ownerConsoleNoteUrl, JOURNAL_DRIVE, OWNER_CONSOLE_APP_ID } from '@/lib/homebase/config';

const ROOT = 'https://bishwajeetparhi.dev';
const DRIVE_KEY = 'd5f411fa83fd4854a3bd7e974cc9bca9_30743710039d4b97bbd352f343d1c9df';

describe('owner console links', () => {
    it('puts the drive under the app that owns it', () => {
        expect(ownerConsoleDriveUrl(ROOT, 'c762ee78-4274-4734-8091-9d8080d7a825')).toBe(
            `${ROOT}/owner/apps/c762ee78-4274-4734-8091-9d8080d7a825/drives/${DRIVE_KEY}`,
        );
    });

    it("puts it under the owner console when the owner isn't known", () => {
        const expected = `${ROOT}/owner/apps/ac126e09-54cb-4878-a690-856be692da16/drives/${DRIVE_KEY}`;
        expect(ownerConsoleDriveUrl(ROOT)).toBe(expected);
        expect(ownerConsoleDriveUrl(ROOT, null)).toBe(expected);
        expect(OWNER_CONSOLE_APP_ID).toBe('ac126e09-54cb-4878-a690-856be692da16');
    });

    it('links a note on that drive', () => {
        expect(ownerConsoleNoteUrl(ROOT, '5837f419-a07e-9d00-e198-80565c4f0874')).toBe(
            `${ROOT}/owner/apps/${OWNER_CONSOLE_APP_ID}/drives/${DRIVE_KEY}/5837f419-a07e-9d00-e198-80565c4f0874`,
        );
    });

    it('uses the drive alias/type as stored — hex, no dashes', () => {
        expect(JOURNAL_DRIVE.alias).not.toContain('-');
        expect(JOURNAL_DRIVE.type).not.toContain('-');
    });
});
