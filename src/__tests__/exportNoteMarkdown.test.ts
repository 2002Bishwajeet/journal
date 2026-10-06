import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const { mockExtract, mockToastError } = vi.hoisted(() => ({
    mockExtract: vi.fn(),
    mockToastError: vi.fn(),
}));
vi.mock('@/lib/yjs-utils', () => ({ extractMarkdownFromYjs: mockExtract }));
vi.mock('sonner', () => ({ toast: { error: mockToastError } }));

import { exportNoteAsMarkdown } from '@/lib/importexport/exportNoteMarkdown';

describe('exportNoteAsMarkdown', () => {
    let blobs: Blob[];
    let anchors: { href: string; download: string; click: ReturnType<typeof vi.fn> }[];

    beforeEach(() => {
        blobs = [];
        anchors = [];
        mockExtract.mockReset();
        mockToastError.mockReset();
        vi.stubGlobal('URL', {
            createObjectURL: vi.fn((blob: Blob) => {
                blobs.push(blob);
                return 'blob:test';
            }),
            revokeObjectURL: vi.fn(),
        });
        vi.stubGlobal('document', {
            createElement: vi.fn(() => {
                const a = { href: '', download: '', click: vi.fn() };
                anchors.push(a);
                return a;
            }),
            body: { appendChild: vi.fn(), removeChild: vi.fn() },
        });
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it('downloads "<title>.md" with a "# Title" header above the markdown', async () => {
        mockExtract.mockResolvedValue('Some **body**');
        await exportNoteAsMarkdown('note-1', 'My Note');

        expect(mockExtract).toHaveBeenCalledWith('note-1');
        expect(anchors[0].download).toBe('My Note.md');
        expect(anchors[0].click).toHaveBeenCalledOnce();
        expect(blobs[0].type).toBe('text/markdown');
        expect(await blobs[0].text()).toBe('# My Note\n\nSome **body**');
    });

    it('falls back to "Untitled" in the content and "untitled" in the file name', async () => {
        mockExtract.mockResolvedValue('body');
        await exportNoteAsMarkdown('note-1', '');

        expect(anchors[0].download).toBe('untitled.md');
        expect(await blobs[0].text()).toBe('# Untitled\n\nbody');
    });

    it('shows an error toast and downloads nothing when extraction fails', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        mockExtract.mockRejectedValue(new Error('boom'));
        await exportNoteAsMarkdown('note-1', 'My Note');

        expect(mockToastError).toHaveBeenCalledWith('Failed to export note');
        expect(anchors).toHaveLength(0);
    });
});
