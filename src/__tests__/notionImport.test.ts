// @vitest-environment happy-dom
/**
 * Notion "Markdown & CSV" export import (#595): id-suffixed names, title headings,
 * databases as tables, nested part zips.
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
    csvTable, databaseCsvs, databaseTable, dropTitleHeading, parseCsv, stripNotionId, titleOf,
} from '@/lib/importexport/markdownImport';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';

// happy-dom has no createImageBitmap; the ingest itself is covered in imageIngest.test.ts
vi.mock('@/lib/images/imageIngest', () => ({ prepareImageForUpload: async (file: File) => file }));

import { ImportService } from '@/lib/importexport/ImportService';

const ID = '0123456789abcdef0123456789abcdef';
const ID2 = 'fedcba9876543210fedcba9876543210';
const HEX = /[0-9a-f]{32}/i;

describe('Notion names', () => {
    it('strips the id suffix from a name', () => {
        expect(stripNotionId(`Project ${ID}`)).toBe('Project');
        expect(stripNotionId(`Project ${ID.toUpperCase()}`)).toBe('Project');
        // Not a Notion id: too short, no space, or not at the end
        expect(stripNotionId('Project 0123abcd')).toBe('Project 0123abcd');
        expect(stripNotionId(`Project${ID}`)).toBe(`Project${ID}`);
        expect(stripNotionId(`${ID} Project`)).toBe(`${ID} Project`);
    });

    it('titles a page or database by its file name without the id or _all', () => {
        expect(titleOf(`Work ${ID}/Project ${ID2}.md`)).toBe('Project');
        expect(titleOf(`Tasks ${ID}.csv`)).toBe('Tasks');
        expect(titleOf(`Tasks ${ID}_all.csv`)).toBe('Tasks');
        expect(titleOf('Plain.md')).toBe('Plain');
    });

    it('drops the first heading only when it is the title', () => {
        expect(dropTitleHeading('# Project\n\nBody', 'Project')).toBe('Body');
        expect(dropTitleHeading('# Project', 'Project')).toBe('');
        expect(dropTitleHeading('# Project\r\n\r\nBody', 'Project')).toBe('Body');
        expect(dropTitleHeading('# Other\n\nBody', 'Project')).toBe('# Other\n\nBody');
        expect(dropTitleHeading('Intro\n# Project', 'Project')).toBe('Intro\n# Project');
        expect(dropTitleHeading('## Project\nBody', 'Project')).toBe('## Project\nBody');
    });
});

describe('parseCsv', () => {
    it('reads quoted fields with commas, newlines and "" escapes, and drops a BOM', () => {
        const csv = '﻿Name,Notes\r\n"Smith, Jo","line one\nline two"\r\nPlain,"say ""hi"""\r\n';
        expect(parseCsv(csv)).toEqual([
            ['Name', 'Notes'],
            ['Smith, Jo', 'line one\nline two'],
            ['Plain', 'say "hi"'],
        ]);
    });

    it('keeps empty fields, reads a last line without a newline and skips blank lines', () => {
        expect(parseCsv('a,,c\n\n1,2,')).toEqual([['a', '', 'c'], ['1', '2', '']]);
        expect(parseCsv('')).toEqual([]);
    });
});

describe('csvTable', () => {
    it('builds a Markdown table with | and newlines escaped and linked first cells', () => {
        const rows = [['Name', 'Notes'], ['Row A', 'x | y'], ['Row B', 'one\ntwo'], ['', 'no name']];
        expect(csvTable(rows, (cell) => (cell === 'Row A' ? 'id-a' : undefined))).toBe([
            '| Name | Notes |',
            '| --- | --- |',
            '| [Row A](journal:note/id-a) | x \\| y |',
            '| Row B | one<br>two |',
            '|  | no name |',
        ].join('\n'));
    });

    it('pads short rows to the widest row', () => {
        expect(csvTable([['A', 'B'], ['1']], () => undefined)).toBe('| A | B |\n| --- | --- |\n| 1 |  |');
        expect(csvTable([], () => undefined)).toBe('');
    });

    it('links a row to the page of that name in the database folder only', () => {
        const notes = [
            { path: `Tasks ${ID}/Row A ${ID2}.md`, id: 'id-a' },
            { path: `Tasks ${ID}/Sub/Row B ${ID2}.md`, id: 'id-deep' },
            { path: `Row B ${ID2}.md`, id: 'id-outside' },
        ];
        const table = databaseTable('Name\nRow A\nRow B', `Tasks ${ID}_all.csv`, notes);
        expect(table).toContain('| [Row A](journal:note/id-a) |');
        expect(table).toContain('| Row B |');
    });
});

describe('databaseCsvs', () => {
    it('prefers X_all.csv over X.csv, and keeps a CSV without an _all', () => {
        expect(databaseCsvs([`Tasks ${ID}.csv`, `Tasks ${ID}_all.csv`, `People ${ID2}.csv`]))
            .toEqual([`Tasks ${ID}_all.csv`, `People ${ID2}.csv`]);
    });
});

describe('importing a Notion export', () => {
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

    function notionZip(): JSZip {
        const zip = new JSZip();
        zip.file(`Project ${ID}.md`, [
            '# Project',
            '',
            `See [Spec](Project%20${ID}/Spec%20${ID2}.md) and [Tasks](Tasks%20${ID2}.csv).`,
            '',
            `![diagram.png](Project%20${ID}/diagram.png)`,
        ].join('\n'));
        zip.file(`Project ${ID}/Spec ${ID2}.md`, '# Spec\n\nSpec body');
        zip.file(`Project ${ID}/diagram.png`, new Uint8Array([1, 2, 3]));
        zip.file(`Tasks ${ID2}.csv`, '﻿Name,Status\nWrite,Done\n');
        zip.file(`Tasks ${ID2}_all.csv`, '﻿Name,Status,Notes\nWrite,Done,"a, b"\nShip,Todo,"line one\nsaid ""go"""\n');
        zip.file(`Tasks ${ID2}/Write ${ID}.md`, '# Write\n\nStatus: Done');
        zip.file(`Tasks ${ID2}/Ship ${ID}.md`, '# Ship\n\nStatus: Todo');
        zip.file('Export-abc/index.html', '<html></html>');
        return zip;
    }

    async function importZip(zip: JSZip, name = 'notion.zip') {
        return ImportService.importFiles([new File([await zip.generateAsync({ type: 'blob' })], name)]);
    }

    async function expectImported(result: Awaited<ReturnType<typeof importZip>>) {
        expect(result).toMatchObject({ imported: 5, failed: 0, skipped: 1, foldersCreated: 2 });

        const folders = (await getAllFolders()).map((f) => f.name).filter((n) => n !== 'Main').sort();
        expect(folders).toEqual(['Project', 'Tasks']);
        const docs = await getAllDocuments();
        expect(docs.map((d) => d.title).sort()).toEqual(['Project', 'Ship', 'Spec', 'Tasks', 'Write']);
        for (const doc of docs) expect(doc.title).not.toMatch(HEX);
        const byTitle = new Map(docs.map((d) => [d.title, d]));

        // The page: no repeated title, a working link to its sub-page, its image
        const project = byTitle.get('Project')!;
        expect(project.metadata.folderId).toBe(MAIN_FOLDER_ID);
        const page = await nodes(project.docId);
        expect(page.firstChild!.type.name).not.toBe('heading');
        const links: Record<string, unknown>[] = [];
        page.descendants((n) => { if (n.type.name === 'noteLink') links.push(n.attrs); });
        expect(links).toEqual([
            { noteId: byTitle.get('Spec')!.docId, label: 'Spec' },
            { noteId: byTitle.get('Tasks')!.docId, label: 'Tasks' },
        ]);
        const [upload] = await getPendingImageUploads(project.docId);
        expect(Array.from(upload.blobData)).toEqual([1, 2, 3]);
        expect((await nodes(byTitle.get('Spec')!.docId)).textContent).toBe('Spec body');

        // The database: one note, a table of every row (from _all.csv), first cells linked to the row pages
        const tasks = byTitle.get('Tasks')!;
        expect(tasks.metadata.folderId).toBe(MAIN_FOLDER_ID);
        const table = (await nodes(tasks.docId)).firstChild!;
        expect(table.type.name).toBe('table');
        const cells: string[][] = [];
        const rowLinks: unknown[] = [];
        table.forEach((row) => {
            const texts: string[] = [];
            // A note link is an atom: its label is an attribute, not text
            row.forEach((cell) => texts.push(cell.textContent || cell.firstChild?.firstChild?.attrs.label || ''));
            cells.push(texts);
            row.firstChild!.descendants((n) => { if (n.type.name === 'noteLink') rowLinks.push(n.attrs.noteId); });
        });
        expect(cells[0]).toEqual(['Name', 'Status', 'Notes']);
        expect(cells[1]).toEqual(['Write', 'Done', 'a, b']);
        expect(cells[2].slice(0, 2)).toEqual(['Ship', 'Todo']);
        expect(cells[2][2]).toMatch(/^line one\s*said "go"$/);
        expect(rowLinks).toEqual([byTitle.get('Write')!.docId, byTitle.get('Ship')!.docId]);

        // Row pages are notes of the database's folder
        const tasksFolder = (await getAllFolders()).find((f) => f.name === 'Tasks')!;
        expect(byTitle.get('Write')!.metadata.folderId).toBe(tasksFolder.id);
        expect((await nodes(byTitle.get('Write')!.docId)).textContent).toBe('Status: Done');
    }

    it('imports pages, sub-pages, images and databases with clean names', async () => {
        await expectImported(await importZip(notionZip()));
    });

    it('imports an export wrapped in an outer zip of parts the same way', async () => {
        const outer = new JSZip();
        outer.file(`Export-${ID}-Part-1.zip`, await notionZip().generateAsync({ type: 'uint8array' }));
        await expectImported(await importZip(outer, `${ID}.zip`));
    });

    it('splits an export across parts and still resolves links between them', async () => {
        const one = new JSZip();
        one.file(`Project ${ID}.md`, `# Project\n\n[Spec](Project%20${ID}/Spec%20${ID2}.md)`);
        const two = new JSZip();
        two.file(`Project ${ID}/Spec ${ID2}.md`, '# Spec');
        const outer = new JSZip();
        outer.file('Export-Part-1.zip', await one.generateAsync({ type: 'uint8array' }));
        outer.file('Export-Part-2.zip', await two.generateAsync({ type: 'uint8array' }));
        expect((await importZip(outer)).imported).toBe(2);

        const docs = new Map((await getAllDocuments()).map((d) => [d.title, d]));
        const links: unknown[] = [];
        (await nodes(docs.get('Project')!.docId)).descendants((n) => { if (n.type.name === 'noteLink') links.push(n.attrs.noteId); });
        expect(links).toEqual([docs.get('Spec')!.docId]);
    });
});
