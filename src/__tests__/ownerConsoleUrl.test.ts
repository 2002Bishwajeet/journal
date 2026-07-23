import { describe, it, expect } from 'vitest';
import { ownerConsoleNoteUrl, JOURNAL_DRIVE } from '@/lib/homebase/config';

describe('ownerConsoleNoteUrl', () => {
    it('composes the Owner Console drive deep link', () => {
        expect(
            ownerConsoleNoteUrl('https://bishwajeetparhi.dev', '5837f419-a07e-9d00-e198-80565c4f0874'),
        ).toBe(
            'https://bishwajeetparhi.dev/owner/drives/d5f411fa83fd4854a3bd7e974cc9bca9_30743710039d4b97bbd352f343d1c9df/5837f419-a07e-9d00-e198-80565c4f0874',
        );
    });

    it('uses the drive alias/type as stored — hex, no dashes', () => {
        expect(JOURNAL_DRIVE.alias).not.toContain('-');
        expect(JOURNAL_DRIVE.type).not.toContain('-');
    });
});
