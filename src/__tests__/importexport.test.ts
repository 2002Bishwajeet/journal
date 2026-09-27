// @vitest-environment happy-dom
/**
 * Import/Export Integration Tests
 *
 * Tests the import parsing logic (not the file operations).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import * as Y from 'yjs';
import JSZip from 'jszip';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { saveDocumentUpdate, upsertSearchIndex } from '@/lib/db/queries';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';
import type { DocumentMetadata } from '@/types';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

const { mockGetPayloadBytes } = vi.hoisted(() => ({ mockGetPayloadBytes: vi.fn() }));
vi.mock('@homebase-id/js-lib/core', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@homebase-id/js-lib/core')>();
    return { ...actual, getPayloadBytes: mockGetPayloadBytes };
});

import { ExportService } from '@/lib/importexport/ExportService';

// Since we can't import the actual module (it has browser dependencies),
// we'll test the parsing functions directly

describe('Import/Export Logic', () => {

    // ============================================
    // Markdown Parsing Tests
    // ============================================
    describe('Markdown Frontmatter Parsing', () => {
        interface Parsed {
            title: string;
            tags: string[];
            content: string;
        }

        function parseMarkdownWithFrontmatter(text: string, filename: string): Parsed {
            let content = text;
            let title = filename.replace(/\.md$/, '');
            const tags: string[] = [];

            const frontmatterMatch = text.match(/^---\n([\s\S]*?)\n---\n/);
            if (frontmatterMatch) {
                content = text.slice(frontmatterMatch[0].length);

                const titleMatch = frontmatterMatch[1].match(/title:\s*"?([^"\n]+)"?/);
                if (titleMatch) title = titleMatch[1];

                const tagsMatch = frontmatterMatch[1].match(/tags:\s*\[(.*?)\]/);
                if (tagsMatch) {
                    tagsMatch[1].split(',').forEach(tag => {
                        const cleaned = tag.trim().replace(/^["']|["']$/g, '');
                        if (cleaned) tags.push(cleaned);
                    });
                }
            }

            return { title, tags, content };
        }

        it('should parse frontmatter with title', () => {
            const markdown = `---
title: "My Note Title"
---
This is the content.`;

            const result = parseMarkdownWithFrontmatter(markdown, 'file.md');
            expect(result.title).toBe('My Note Title');
            expect(result.content).toBe('This is the content.');
        });

        it('should use filename if no frontmatter title', () => {
            const markdown = `Just content without frontmatter.`;

            const result = parseMarkdownWithFrontmatter(markdown, 'my-note.md');
            expect(result.title).toBe('my-note');
        });

        it('should parse tags from frontmatter', () => {
            const markdown = `---
title: "Tagged Note"
tags: ["work", "important", "project"]
---
Content`;

            const result = parseMarkdownWithFrontmatter(markdown, 'file.md');
            expect(result.tags).toEqual(['work', 'important', 'project']);
        });

        it('should handle empty tags array', () => {
            const markdown = `---
title: "No Tags"
tags: []
---
Content`;

            const result = parseMarkdownWithFrontmatter(markdown, 'file.md');
            expect(result.tags).toEqual([]);
        });
    });

    // ============================================
    // Obsidian Import Parsing Tests
    // ============================================
    describe('Obsidian Format Parsing', () => {

        function convertWikilinks(content: string): string {
            // [[Note]] → [Note](note)
            // [[Note|Display]] → [Display](note)
            return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, display) => {
                const linkText = display || target;
                const linkTarget = target.toLowerCase().replace(/\s+/g, '-');
                return `[${linkText}](${linkTarget})`;
            });
        }

        function convertEmbeds(content: string): string {
            // ![[image.png]] → ![image.png](image.png)
            return content.replace(/!\[\[([^\]]+)\]\]/g, (_, target) => {
                return `![${target}](${target})`;
            });
        }

        function convertCallouts(content: string): string {
            // > [!note] Title → > **Note:** Title
            return content.replace(/^>\s*\[!(\w+)\]\s*(.*?)$/gm, (_, type, rest) => {
                const formattedType = type.charAt(0).toUpperCase() + type.slice(1).toLowerCase();
                return `> **${formattedType}:** ${rest}`;
            });
        }

        function cleanNotionFilename(filename: string): string {
            let name = filename.replace(/\.md$/, '');
            name = name.replace(/\s+[a-f0-9]{32}$/i, '');
            return name.trim() || 'Untitled';
        }

        it('should convert simple wikilinks', () => {
            const input = 'Check out [[My Note]] for details.';
            const result = convertWikilinks(input);
            expect(result).toBe('Check out [My Note](my-note) for details.');
        });

        it('should convert wikilinks with display text', () => {
            const input = 'See [[Technical Document|the docs]] here.';
            const result = convertWikilinks(input);
            expect(result).toBe('See [the docs](technical-document) here.');
        });

        it('should handle multiple wikilinks', () => {
            const input = '[[Note A]] and [[Note B]] and [[Note C]]';
            const result = convertWikilinks(input);
            expect(result).toBe('[Note A](note-a) and [Note B](note-b) and [Note C](note-c)');
        });

        it('should convert image embeds', () => {
            const input = 'Here is an image: ![[screenshot.png]]';
            const result = convertEmbeds(input);
            expect(result).toBe('Here is an image: ![screenshot.png](screenshot.png)');
        });

        it('should convert note embeds', () => {
            const input = '![[Embedded Note]]';
            const result = convertEmbeds(input);
            expect(result).toBe('![Embedded Note](Embedded Note)');
        });

        it('should convert callouts', () => {
            const input = '> [!note] This is important';
            const result = convertCallouts(input);
            expect(result).toBe('> **Note:** This is important');
        });

        it('should handle different callout types', () => {
            expect(convertCallouts('> [!warning] Danger ahead')).toBe('> **Warning:** Danger ahead');
            expect(convertCallouts('> [!tip] Pro tip here')).toBe('> **Tip:** Pro tip here');
            expect(convertCallouts('> [!INFO] Some info')).toBe('> **Info:** Some info');
        });

        it('should clean Notion filename format', () => {
            // Using exactly 32 hex characters (valid Notion UUID format)
            expect(cleanNotionFilename('My Page 12345678901234567890123456789012.md')).toBe('My Page');
            expect(cleanNotionFilename('Simple Note.md')).toBe('Simple Note');
            expect(cleanNotionFilename('Page 0123456789abcdef0123456789abcdef.md')).toBe('Page');
        });
    });

    // ============================================
    // CSV Parsing Tests
    // ============================================
    describe('CSV Parsing', () => {
        function parseCSV(text: string): string[][] {
            const rows: string[][] = [];
            const lines = text.split('\n');

            for (const line of lines) {
                if (!line.trim()) continue;

                const cells: string[] = [];
                let current = '';
                let inQuotes = false;

                for (let i = 0; i < line.length; i++) {
                    const char = line[i];

                    if (char === '"') {
                        if (inQuotes && line[i + 1] === '"') {
                            current += '"';
                            i++;
                        } else {
                            inQuotes = !inQuotes;
                        }
                    } else if (char === ',' && !inQuotes) {
                        cells.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                }

                cells.push(current.trim());
                rows.push(cells);
            }

            return rows;
        }

        it('should parse simple CSV', () => {
            const csv = `Name,Age,City
John,30,NYC
Jane,25,LA`;

            const rows = parseCSV(csv);
            expect(rows.length).toBe(3);
            expect(rows[0]).toEqual(['Name', 'Age', 'City']);
            expect(rows[1]).toEqual(['John', '30', 'NYC']);
            expect(rows[2]).toEqual(['Jane', '25', 'LA']);
        });

        it('should handle quoted fields', () => {
            const csv = `Name,Description
"John Doe","A ""quoted"" value"`;

            const rows = parseCSV(csv);
            expect(rows[1]).toEqual(['John Doe', 'A "quoted" value']);
        });

        it('should handle commas in quoted fields', () => {
            const csv = `Title,Content
"Meeting Notes","Action item 1, action item 2, action item 3"`;

            const rows = parseCSV(csv);
            expect(rows[1][1]).toBe('Action item 1, action item 2, action item 3');
        });

        it('should skip empty lines', () => {
            const csv = `A,B

C,D

E,F`;

            const rows = parseCSV(csv);
            expect(rows.length).toBe(3);
        });
    });

    // ============================================
    // Format Detection Tests
    // ============================================
    describe('Import Format Detection', () => {
        function detectFormat(filenames: string[]): 'obsidian' | 'notion' | 'markdown' | 'unknown' {
            let hasObsidianConfig = false;
            let hasNotionFormat = false;
            let hasMarkdown = false;

            for (const filename of filenames) {
                if (filename.includes('.obsidian/')) {
                    hasObsidianConfig = true;
                }
                if (filename.match(/[a-f0-9]{32}\.md$/i)) {
                    hasNotionFormat = true;
                }
                if (filename.endsWith('.md')) {
                    hasMarkdown = true;
                }
            }

            if (hasObsidianConfig) return 'obsidian';
            if (hasNotionFormat) return 'notion';
            if (hasMarkdown) return 'markdown';
            return 'unknown';
        }

        it('should detect Obsidian vault', () => {
            const files = ['vault/.obsidian/config.json', 'vault/note1.md', 'vault/note2.md'];
            expect(detectFormat(files)).toBe('obsidian');
        });

        it('should detect Notion export', () => {
            const files = ['My Page abc123def456789012345678901234.md', 'Another 1234567890123456789012345678abcd.md'];
            expect(detectFormat(files)).toBe('notion');
        });

        it('should detect plain markdown', () => {
            const files = ['notes/file1.md', 'notes/file2.md'];
            expect(detectFormat(files)).toBe('markdown');
        });

        it('should return unknown for non-markdown', () => {
            const files = ['image.png', 'document.pdf'];
            expect(detectFormat(files)).toBe('unknown');
        });
    });

    // ============================================
    // Filename Sanitization Tests
    // ============================================
    describe('Filename Sanitization', () => {
        function sanitizeFilename(name: string): string {
            return name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'Untitled';
        }

        it('should remove invalid characters', () => {
            expect(sanitizeFilename('my/note')).toBe('my-note');
            expect(sanitizeFilename('file:name')).toBe('file-name');
            expect(sanitizeFilename('test<>file')).toBe('test--file');
        });

        it('should handle multiple invalid characters', () => {
            expect(sanitizeFilename('a/b\\c?d')).toBe('a-b-c-d');
        });

        it('should return Untitled for empty string', () => {
            expect(sanitizeFilename('')).toBe('Untitled');
            expect(sanitizeFilename('   ')).toBe('Untitled');
        });

        it('should preserve valid characters', () => {
            expect(sanitizeFilename('My Note (2023)')).toBe('My Note (2023)');
            expect(sanitizeFilename('Notes-Archive_v2')).toBe('Notes-Archive_v2');
        });
    });
});

// ============================================
// ExportService.exportAllAsZip (real markdown + images)
// ============================================
describe('ExportService.exportAllAsZip', () => {
    const DOC_ID = '11111111-1111-1111-1111-111111111111';
    const fakeDotYouClient = {} as DotYouClient;

    const META = (): DocumentMetadata => ({
        title: 'My Note',
        folderId: MAIN_FOLDER_ID,
        tags: [],
        timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-01T00:00:00.000Z' },
        excludeFromAI: false,
    });

    // A paragraph with bold text followed by an attachment:// image, stored as
    // Yjs document_updates the same way extractMarkdownFromYjs reads them back.
    function noteBlob(fileId: string, payloadKey: string): Uint8Array {
        const doc = new Y.Doc();
        const frag = doc.getXmlFragment('prosemirror');
        const p = new Y.XmlElement('paragraph');
        const t = new Y.XmlText();
        t.insert(0, 'bold');
        t.format(0, 4, { bold: true });
        const img = new Y.XmlElement('image');
        img.setAttribute('src', `attachment://${fileId}/${payloadKey}`);
        img.setAttribute('alt', 'a');
        p.insert(0, [t, img]);
        frag.insert(0, [p]);
        const update = Y.encodeStateAsUpdate(doc);
        doc.destroy();
        return update;
    }

    let db: PGlite;
    beforeAll(async () => {
        db = await createTestDatabase();
        // @ts-expect-error test-only setter
        pgliteModule.setTestDb(db);
    });
    afterAll(async () => { await closeTestDatabase(); });

    let capturedBlob: Blob | undefined;
    beforeEach(async () => {
        await resetTestDatabase();
        vi.clearAllMocks();
        capturedBlob = undefined;
        vi.spyOn(URL, 'createObjectURL').mockImplementation((obj: Blob | MediaSource) => {
            capturedBlob = obj as Blob;
            return 'blob:mock-url';
        });
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    });

    async function exportedZip(dotYouClient: DotYouClient) {
        const result = await ExportService.exportAllAsZip(dotYouClient);
        const buffer = await capturedBlob!.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);
        return { result, zip };
    }

    it('exports real markdown and rewrites an attachment image to a relative asset path bundled in the zip', async () => {
        await saveDocumentUpdate(DOC_ID, noteBlob('remote-file-1', 'jrnl_img0'));
        await upsertSearchIndex({ docId: DOC_ID, title: 'My Note', plainTextContent: 'bold', metadata: META() });
        mockGetPayloadBytes.mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), contentType: 'image/jpeg' });

        const { result, zip } = await exportedZip(fakeDotYouClient);

        expect(result.missingImages).toBe(0);
        const md = await zip.file('My Note.md')!.async('string');
        expect(md).toContain('**bold**');
        expect(md).toContain('![a](assets/My Note-jrnl_img0.jpg)');
        expect(zip.file('assets/My Note-jrnl_img0.jpg')).not.toBeNull();
    });

    it('keeps the attachment:// link and counts a missing image when the fetch fails', async () => {
        await saveDocumentUpdate(DOC_ID, noteBlob('remote-file-1', 'jrnl_img0'));
        await upsertSearchIndex({ docId: DOC_ID, title: 'My Note', plainTextContent: 'bold', metadata: META() });
        mockGetPayloadBytes.mockRejectedValue(new Error('404'));

        const { result, zip } = await exportedZip(fakeDotYouClient);

        expect(result.missingImages).toBe(1);
        const md = await zip.file('My Note.md')!.async('string');
        expect(md).toContain('![a](attachment://remote-file-1/jrnl_img0)');
    });
});
