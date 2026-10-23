// @vitest-environment happy-dom
/**
 * Import transforms (#593): wiki links, embeds, tags, front-matter, callouts and the
 * vault folder rules, then a zipped Obsidian vault imported end to end.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import * as Y from 'yjs';
import JSZip from 'jszip';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import type { Node as PMNode } from '@tiptap/pm/model';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';
import { getAllDocuments, getAllFolders, getDocumentUpdates, getPendingImageUploads } from '@/lib/db/queries';
import { editorSchema } from '@/lib/agent/editEngine';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';
import {
    commonRoot, convertMarkdown, folderOf, inlineTags, isSkippedPath, parseFrontMatter,
} from '@/lib/importexport/markdownImport';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

// happy-dom has no createImageBitmap; the ingest itself is covered in imageIngest.test.ts
vi.mock('@/lib/images/imageIngest', () => ({ prepareImageForUpload: async (file: File) => file }));

import { ImportService } from '@/lib/importexport/ImportService';

const NOTES = [
    { path: 'Vault/A.md', id: 'id-a' },
    { path: 'Vault/Work/B.md', id: 'id-b' },
    { path: 'Vault/One/Dup.md', id: 'id-d1' },
    { path: 'Vault/Two/Dup.md', id: 'id-d2' },
];
const FILES = [...NOTES.map((n) => n.path), 'Vault/attachments/pic.png', 'Vault/attachments/doc.pdf'];
const convert = (md: string) => convertMarkdown(md, 'Vault/A.md', NOTES, FILES);

describe('convertMarkdown: links', () => {
    it('links a wiki link by file name, case-insensitively, with alias, heading and block ref', () => {
        expect(convert('[[B]]')).toBe('[B](journal:note/id-b)');
        expect(convert('[[b.md]]')).toBe('[b](journal:note/id-b)');
        expect(convert('[[B|see B]]')).toBe('[see B](journal:note/id-b)');
        expect(convert('[[B#Part]]')).toBe('[B](journal:note/id-b)');
        expect(convert('[[B#^abc123|ref]]')).toBe('[ref](journal:note/id-b)');
        expect(convert('| [[B\\|cell]] |')).toBe('| [cell](journal:note/id-b) |');
    });

    it('matches a target with a path against the path', () => {
        expect(convert('[[One/Dup]]')).toBe('[One/Dup](journal:note/id-d1)');
        expect(convert('[[Work/B|x]]')).toBe('[x](journal:note/id-b)');
    });

    it('leaves a missing or ambiguous link as its label, without brackets', () => {
        expect(convert('See [[Missing]].')).toBe('See Missing.');
        expect(convert('[[Missing|alias]]')).toBe('alias');
        expect(convert('[[Dup]]')).toBe('Dup');
    });

    it('escapes brackets in the label', () => {
        expect(convert('[[B|a \\ c]]')).toBe('[a \\\\ c](journal:note/id-b)');
    });

    it('turns a relative .md link to a note of the batch into a note link, and nothing else', () => {
        expect(convert('[go](Work/B.md)')).toBe('[go](journal:note/id-b)');
        expect(convert('[go](<Work/B.md>)')).toBe('[go](journal:note/id-b)');
        expect(convert('[go](Work/Nope.md)')).toBe('[go](Work/Nope.md)');
        expect(convert('[site](https://example.com/B.md)')).toBe('[site](https://example.com/B.md)');
        expect(convert('[pdf](attachments/doc.pdf)')).toBe('[pdf](attachments/doc.pdf)');
        expect(convertMarkdown('[up](../A.md)', 'Vault/Work/B.md', NOTES, FILES)).toBe('[up](journal:note/id-a)');
        expect(convertMarkdown('[x](Other%20Note.md)', 'Other Note.md', [{ path: 'Other Note.md', id: 'n' }], [])).toBe('[x](journal:note/n)');
    });

    it('leaves fenced and inline code alone', () => {
        expect(convert('`[[B]]` and [[B]]')).toBe('`[[B]]` and [B](journal:note/id-b)');
        expect(convert('```\n[[B]]\n> [!NOTE]\n```')).toBe('```\n[[B]]\n> [!NOTE]\n```');
        expect(convert('~~~md\n![[pic.png]]')).toBe('~~~md\n![[pic.png]]');
    });

    it('leaves Journal note links and plain Markdown as they are', () => {
        const md = '# Title\n\n[x](journal:note/abc-1) and **bold** and [y](https://e.com)\n\n> quote';
        expect(convert(md)).toBe(md);
    });
});

describe('convertMarkdown: embeds', () => {
    it('finds an embedded image by file name anywhere in the zip and ignores the size', () => {
        expect(convert('![[pic.png]]')).toBe('![pic.png](/Vault/attachments/pic.png)');
        expect(convert('![[pic.png|300]]')).toBe('![pic.png](/Vault/attachments/pic.png)');
    });

    it('encodes the file path so the image link parses', () => {
        expect(convertMarkdown('![[a (1).png]]', 'n.md', [], ['img/a (1).png'])).toBe('![a (1).png](/img/a%20%281%29.png)');
    });

    it('turns a note embed into a note link, and a missing or non-image embed into its file name', () => {
        expect(convert('![[B]]')).toBe('[B](journal:note/id-b)');
        expect(convert('![[Missing]]')).toBe('Missing');
        expect(convert('![[gone.png]]')).toBe('gone.png');
        expect(convert('![[doc.pdf]]')).toBe('doc.pdf');
    });
});

describe('convertMarkdown: callouts', () => {
    it('maps Obsidian types to the four variants, case-insensitively', () => {
        const variant = (type: string) => convert(`> [!${type}]\n> body`).split('\n')[0];
        for (const t of ['note', 'NOTE', 'info', 'abstract', 'summary', 'tldr', 'todo', 'question', 'quote', 'custom']) expect(variant(t)).toBe('> [!info]');
        for (const t of ['tip', 'hint', 'important', 'success', 'check', 'done']) expect(variant(t)).toBe('> [!tip]');
        for (const t of ['warning', 'Caution', 'attention']) expect(variant(t)).toBe('> [!warning]');
        for (const t of ['danger', 'error', 'bug', 'failure', 'fail', 'missing']) expect(variant(t)).toBe('> [!error]');
    });

    it('drops the fold marker and puts a title in bold as the first line', () => {
        expect(convert('> [!danger]-\n> body')).toBe('> [!error]\n> body');
        expect(convert('> [!warning]+ Careful\n> body')).toBe('> [!warning]\n> **Careful**\n>\n> body');
        expect(convert('> [!info]\n> body')).toBe('> [!info]\n> body');
    });
});

describe('parseFrontMatter', () => {
    it('reads CRLF front-matter and leaves none of it in the body', () => {
        const fm = parseFrontMatter('---\r\ntitle: "Hi"\r\ncreated: 2024-01-02\r\n---\r\nBody\r\nline');
        expect(fm).toMatchObject({ title: 'Hi', created: '2024-01-02', content: 'Body\nline' });
        expect(fm.modified).toBeUndefined();
    });

    it('reads tags as an inline list, a comma string or a YAML list, without a leading #', () => {
        expect(parseFrontMatter('---\ntags: ["work", important]\n---\n').tags).toEqual(['work', 'important']);
        expect(parseFrontMatter('---\ntags: a, #b\n---\n').tags).toEqual(['a', 'b']);
        expect(parseFrontMatter('---\ntags:\n  - one\n  - "#two"\naliases:\n  - nope\n---\n').tags).toEqual(['one', 'two']);
        expect(parseFrontMatter('---\ntags: []\n---\n').tags).toEqual([]);
    });

    it('reads Journal export front-matter', () => {
        const fm = parseFrontMatter('---\ntitle: "A: b"\ncreated: "2026-01-01T00:00:00.000Z"\nmodified: "2026-01-02T00:00:00.000Z"\nexcludeFromAI: true\n---\n\nText');
        expect(fm).toEqual({
            title: 'A: b', tags: [], created: '2026-01-01T00:00:00.000Z', modified: '2026-01-02T00:00:00.000Z',
            excludeFromAI: true, content: 'Text',
        });
    });

    it('treats text without front-matter as the body', () => {
        expect(parseFrontMatter('Just text\r\n')).toEqual({ title: '', tags: [], excludeFromAI: false, content: 'Just text' });
    });
});

describe('inlineTags', () => {
    it('finds #tag and #nested/tag, not headings, code, URLs, link headings or numbers', () => {
        const md = [
            '# Heading',
            '#idea and #nested/tag here',
            'issue #12, [[Note#Part]], https://e.com/#frag, `#code`',
            '```\n#fenced\n```',
        ].join('\n');
        expect(inlineTags(md)).toEqual(['idea', 'nested/tag']);
    });
});

describe('vault paths', () => {
    it('skips .obsidian, .trash, dot segments and __MACOSX', () => {
        expect(isSkippedPath('Vault/.obsidian/app.json')).toBe(true);
        expect(isSkippedPath('Vault/.trash/Old.md')).toBe(true);
        expect(isSkippedPath('__MACOSX/Vault/._A.md')).toBe(true);
        expect(isSkippedPath('Vault/.DS_Store')).toBe(true);
        expect(isSkippedPath('Vault/Work/B.md')).toBe(false);
    });

    it('strips the one top-level folder every entry is under, and only that', () => {
        expect(commonRoot(['Vault/A.md', 'Vault/Work/B.md'])).toBe('Vault/');
        expect(commonRoot(['A.md', 'Work/B.md'])).toBe('');
        expect(commonRoot(['Work/A.md', 'Home/B.md'])).toBe('');
        expect(commonRoot(['A.md'])).toBe('');
    });

    it('puts a note in its top-level folder below the root', () => {
        expect(folderOf('Vault/Work/2024/Q1.md', 'Vault/')).toBe('Work');
        expect(folderOf('Vault/A.md', 'Vault/')).toBe('');
        expect(folderOf('Work/B.md', '')).toBe('Work');
        expect(folderOf('A.md', '')).toBe('');
    });
});

// ============================================
// ImportService with a zipped vault
// ============================================
describe('ImportService: zipped Obsidian vault', () => {
    let db: PGlite;
    beforeAll(async () => {
        db = await createTestDatabase();
        // @ts-expect-error test-only setter
        pgliteModule.setTestDb(db);
    });
    afterAll(async () => { await closeTestDatabase(); });
    beforeEach(async () => {
        await resetTestDatabase();
        vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:mock-${Math.random()}`);
    });

    async function nodes(docId: string): Promise<PMNode> {
        const ydoc = new Y.Doc();
        for (const update of await getDocumentUpdates(docId)) Y.applyUpdate(ydoc, update);
        return yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment('prosemirror'), editorSchema);
    }

    // Even seconds: zip entry dates have a 2-second resolution
    const entryDate = new Date('2023-05-06T07:08:10.000Z');

    async function importVault() {
        const zip = new JSZip();
        zip.file('Vault/.obsidian/app.json', '{}');
        zip.file('Vault/.trash/Old.md', '# Old');
        zip.file('Vault/A.md', [
            'Links: [[B]], [[B|see B]], [[B#Part]] and [[Missing]].',
            '',
            '![[pic.png]]',
            '',
            '> [!NOTE]',
            '> Plain note',
            '',
            '> [!warning] Careful',
            '> Mind the step',
            '',
            '> [!danger]-',
            '> Hidden',
            '',
            'An #idea.',
        ].join('\n'), { date: entryDate });
        zip.file('Vault/Work/B.md', '# B');
        zip.file('Vault/Work/2024/C.md', '---\r\ntitle: Quarter\r\ntags:\r\n  - plan\r\n  - q1\r\n---\r\nC body\r\n');
        zip.file('Vault/attachments/pic.png', new Uint8Array([1, 2, 3]));
        const file = new File([await zip.generateAsync({ type: 'blob' })], 'vault.zip');
        return ImportService.importFiles([file]);
    }

    it('imports the notes with working links, images, callouts, tags, dates and folders', async () => {
        const result = await importVault();
        expect(result).toMatchObject({ imported: 3, failed: 0, foldersCreated: 1 });

        const folders = await getAllFolders();
        expect(folders.map((f) => f.name).filter((n) => n !== 'Main')).toEqual(['Work']);
        const work = folders.find((f) => f.name === 'Work')!;

        const docs = await getAllDocuments();
        const byTitle = new Map(docs.map((d) => [d.title, d]));
        expect([...byTitle.keys()].sort()).toEqual(['A', 'B', 'Quarter']);
        const a = byTitle.get('A')!;
        const b = byTitle.get('B')!;
        const c = byTitle.get('Quarter')!;
        expect(a.metadata.folderId).toBe(MAIN_FOLDER_ID);
        expect(b.metadata.folderId).toBe(work.id);
        expect(c.metadata.folderId).toBe(work.id);

        // Tags from a YAML list and from the body
        expect(c.metadata.tags).toEqual(['plan', 'q1']);
        expect(a.metadata.tags).toEqual(['idea']);
        // No front-matter dates: the zip entry's date
        expect(a.metadata.timestamps).toEqual({ created: entryDate.toISOString(), modified: entryDate.toISOString() });

        const root = await nodes(a.docId);
        const links: Record<string, unknown>[] = [];
        const callouts: { variant: string; text: string; bold: string[] }[] = [];
        const images: PMNode[] = [];
        root.descendants((n) => {
            if (n.type.name === 'noteLink') links.push(n.attrs);
            if (n.type.name === 'image') images.push(n);
            if (n.type.name === 'callout') {
                const bold: string[] = [];
                n.descendants((t) => { if (t.marks.some((m) => m.type.name === 'bold')) bold.push(t.text!); });
                callouts.push({ variant: n.attrs.variant, text: n.textContent, bold });
            }
        });
        expect(links).toEqual([
            { noteId: b.docId, label: 'B' },
            { noteId: b.docId, label: 'see B' },
            { noteId: b.docId, label: 'B' },
        ]);
        expect(root.textContent).toContain('and Missing.');
        expect(callouts).toEqual([
            { variant: 'info', text: 'Plain note', bold: [] },
            { variant: 'warning', text: 'CarefulMind the step', bold: ['Careful'] },
            { variant: 'error', text: 'Hidden', bold: [] },
        ]);

        const [upload] = await getPendingImageUploads(a.docId);
        expect(Array.from(upload.blobData)).toEqual([1, 2, 3]);
        expect(images).toHaveLength(1);
        expect(String(images[0].attrs['data-pending-id']).replace(/-/g, '')).toBe(upload.id.replace(/-/g, ''));

        // CRLF front-matter: title read, none of it in the body
        expect((await nodes(c.docId)).textContent).toBe('C body');
    });

    it('imports a Journal export as before: root notes into Main, folders by name', async () => {
        const zip = new JSZip();
        const fm = (title: string) => `---\ntitle: "${title}"\ncreated: "2026-01-01T00:00:00.000Z"\nmodified: "2026-01-02T00:00:00.000Z"\ntags: ["x"]\n---\n\n`;
        zip.file('Root.md', `${fm('Root')}Hello [Other](journal:note/old-id)`);
        zip.file('Work/Plan.md', `${fm('Plan')}> [!tip]\n> Do it`);
        const file = new File([await zip.generateAsync({ type: 'blob' })], 'journal-export.zip');

        expect((await ImportService.importFiles([file])).imported).toBe(2);
        const docs = new Map((await getAllDocuments()).map((d) => [d.title, d]));
        const work = (await getAllFolders()).find((f) => f.name === 'Work')!;
        expect(docs.get('Root')!.metadata).toMatchObject({
            folderId: MAIN_FOLDER_ID, tags: ['x'],
            timestamps: { created: '2026-01-01T00:00:00.000Z', modified: '2026-01-02T00:00:00.000Z' },
        });
        expect(docs.get('Plan')!.metadata.folderId).toBe(work.id);
        const callout = (await nodes(docs.get('Plan')!.docId)).firstChild!;
        expect(callout.type.name).toBe('callout');
        expect(callout.attrs.variant).toBe('tip');
    });

    it('dates a loose .md file by its last-modified time', async () => {
        const file = new File(['# Loose'], 'Loose.md', { lastModified: entryDate.getTime() });
        expect((await ImportService.importFiles([file])).imported).toBe(1);
        const [doc] = await getAllDocuments();
        expect(doc.metadata.timestamps.created).toBe(entryDate.toISOString());
    });
});
