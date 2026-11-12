import { describe, it, expect } from 'vitest';
import { generateMarkdown } from '@/lib/importexport/ExportService';
import { sanitizeFilename } from '@/lib/importexport/fileNames';
import { parseFrontMatter } from '@/lib/importexport/markdownImport';
import type { SearchIndexEntry } from '@/types';

const note: SearchIndexEntry = {
    docId: 'doc-1',
    title: 'My "note"',
    plainTextContent: '',
    metadata: {
        title: 'My "note"',
        folderId: 'main',
        tags: ['a'],
        timestamps: { created: '2026-01-01T00:00:00Z', modified: '2026-01-02T00:00:00Z' },
        excludeFromAI: false,
    },
};

describe('generateMarkdown', () => {
    it('leaves the front matter as the ZIP export has always written it without an id', () => {
        expect(generateMarkdown(note, 'Body')).not.toContain('id:');
    });

    it('writes the note id as the first front-matter key when given one (notes mirror, #1015)', () => {
        const text = generateMarkdown(note, 'Body', 'doc-1');
        expect(text.startsWith('---\nid: "doc-1"\ntitle: ')).toBe(true);
    });

    it('still imports: the id key is ignored and the rest reads back', () => {
        const parsed = parseFrontMatter(generateMarkdown(note, 'Body', 'doc-1'));
        expect(parsed.title).toBe('My "note"');
        expect(parsed.tags).toEqual(['a']);
        expect(parsed.content).toBe('Body');
    });
});

describe('sanitizeFilename', () => {
    it('replaces characters invalid in file names', () => {
        expect(sanitizeFilename(' a/b:c ')).toBe('a_b_c');
    });
});
