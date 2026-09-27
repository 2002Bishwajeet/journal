/**
 * parseAttachmentSrc guards the public share page's image renderer: a note's
 * markdown can contain an `attachment://<fileId>/<payloadKey>` ref copied from
 * another note (copy/paste keeps the original src), which would otherwise let
 * a public page fetch a payload that belongs to a private file.
 */
import { describe, it, expect } from 'vitest';
import { parseAttachmentSrc } from '@/lib/utils/attachmentSrc';

const NOTE_FILE_ID = 'file-abc';

describe('parseAttachmentSrc', () => {
    it('parses a valid attachment ref for the current note', () => {
        expect(parseAttachmentSrc('attachment://file-abc/jrnl_img', NOTE_FILE_ID)).toEqual({
            fileId: 'file-abc',
            payloadKey: 'jrnl_img',
        });
    });

    it('returns null when the ref points at a different fileId', () => {
        expect(parseAttachmentSrc('attachment://other-file/jrnl_img', NOTE_FILE_ID)).toBeNull();
    });

    it('returns null for a blob: src', () => {
        expect(parseAttachmentSrc('blob:https://example.com/1234', NOTE_FILE_ID)).toBeNull();
    });

    it('returns null for an https: src', () => {
        expect(parseAttachmentSrc('https://example.com/pic.png', NOTE_FILE_ID)).toBeNull();
    });
});
