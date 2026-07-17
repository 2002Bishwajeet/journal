import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import * as Y from 'yjs';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => {
    let testDb: PGlite | null = null;
    return { getDatabase: async () => testDb, setTestDb: (db: PGlite) => { testDb = db; } };
});
import * as pgliteModule from '@/lib/db/pglite';
import { getDocumentUpdates, saveDocumentUpdate, upsertSearchIndex, getSearchIndexEntry } from '@/lib/db/queries';
import { createNoteWithContentInDb, createNoteFromTemplateInDb } from '@/hooks/useNotes';

let db: PGlite;
beforeAll(async () => {
    db = await createTestDatabase();
    // @ts-expect-error test-only setter
    pgliteModule.setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => { await resetTestDatabase(); });

async function loadFragment(docId: string): Promise<Y.XmlElement[]> {
    const updates = await getDocumentUpdates(docId);
    const ydoc = new Y.Doc();
    for (const u of updates) Y.applyUpdate(ydoc, u);
    return ydoc.getXmlFragment('prosemirror').toArray() as Y.XmlElement[];
}

function blockText(el: Y.XmlElement): string {
    return el
        .toArray()
        .map((c) => (c instanceof Y.XmlText ? c.toString() : ''))
        .join('');
}

describe('createNoteWithContentInDb content structure', () => {
    it('renders a leading "# " line as a level-1 heading, not literal text', async () => {
        const { docId } = await createNoteWithContentInDb({
            title: '2026-07-17',
            content: '# 2026-07-17\n\n',
            folderId: 'main',
        });
        const blocks = await loadFragment(docId);
        expect(blocks[0].nodeName).toBe('heading');
        expect(blocks[0].getAttribute('level')).toBe(1);
        expect(blockText(blocks[0])).toBe('2026-07-17');
        // A trailing heading gets an empty paragraph so typing starts as body
        expect(blocks[1].nodeName).toBe('paragraph');
        // No block anywhere carries the literal "#"
        expect(blocks.map(blockText).join('\n')).not.toContain('#');
        // The search index holds the rendered text, not the raw markdown
        const entry = await getSearchIndexEntry(docId);
        expect(entry?.plainTextContent).toBe('2026-07-17');
    });

    it('splits lines into separate blocks with heading levels', async () => {
        const { docId } = await createNoteWithContentInDb({
            title: 'T',
            content: '# Title\n\n## Section\nfirst line\nsecond line\n',
            folderId: 'main',
        });
        const blocks = await loadFragment(docId);
        expect(blocks.map((b) => b.nodeName)).toEqual(['heading', 'heading', 'paragraph', 'paragraph']);
        expect(blocks[1].getAttribute('level')).toBe(2);
        expect(blockText(blocks[2])).toBe('first line');
        expect(blockText(blocks[3])).toBe('second line');
    });

    it('keeps plain text as a paragraph and empty content as one empty paragraph', async () => {
        const plain = await createNoteWithContentInDb({ title: 'P', content: 'hello there', folderId: 'main' });
        const plainBlocks = await loadFragment(plain.docId);
        expect(plainBlocks.map((b) => b.nodeName)).toEqual(['paragraph']);
        expect(blockText(plainBlocks[0])).toBe('hello there');

        const empty = await createNoteWithContentInDb({ title: 'E', content: '', folderId: 'main' });
        const emptyBlocks = await loadFragment(empty.docId);
        expect(emptyBlocks.map((b) => b.nodeName)).toEqual(['paragraph']);
        expect(blockText(emptyBlocks[0])).toBe('');
    });
});

describe('createNoteFromTemplateInDb', () => {
    const TEMPLATE_ID = '30000000-0000-0000-0000-000000000001';

    /** Seed a rich template: H1 with {{date}}, a task list, a bold run. */
    async function seedTemplate() {
        const ydoc = new Y.Doc();
        const fragment = ydoc.getXmlFragment('prosemirror');

        const heading = new Y.XmlElement('heading');
        heading.setAttribute('level', 1 as unknown as string);
        heading.push([new Y.XmlText('Journal {{date}}')]);

        const taskItemPara = new Y.XmlElement('paragraph');
        taskItemPara.push([new Y.XmlText('Review inbox')]);
        const taskItem = new Y.XmlElement('taskItem');
        taskItem.setAttribute('checked', 'false');
        taskItem.push([taskItemPara]);
        const taskList = new Y.XmlElement('taskList');
        taskList.push([taskItem]);

        const para = new Y.XmlElement('paragraph');
        const bold = new Y.XmlText();
        bold.insert(0, 'Logged {{date}}', { bold: {} });
        para.push([bold]);

        fragment.push([heading, taskList, para]);
        await saveDocumentUpdate(TEMPLATE_ID, Y.encodeStateAsUpdate(ydoc));

        const now = new Date().toISOString();
        await upsertSearchIndex({
            docId: TEMPLATE_ID,
            title: 'Daily template',
            plainTextContent: 'Journal {{date}} Review inbox Logged {{date}}',
            metadata: {
                title: 'Daily template',
                folderId: 'main',
                tags: [],
                timestamps: { created: now, modified: now },
                excludeFromAI: false,
            },
        });
    }

    it('preserves the full block structure of the template', async () => {
        await seedTemplate();
        const { docId } = await createNoteFromTemplateInDb({
            templateDocId: TEMPLATE_ID,
            title: '2026-07-17',
            folderId: 'main',
            dateString: '2026-07-17',
        });
        const blocks = await loadFragment(docId);
        expect(blocks.map((b) => b.nodeName)).toEqual(['heading', 'taskList', 'paragraph']);
        const taskItem = blocks[1].toArray()[0] as Y.XmlElement;
        expect(taskItem.nodeName).toBe('taskItem');
        expect(taskItem.getAttribute('checked')).toBe('false');
    });

    it('substitutes {{date}} inside text nodes and keeps formatting marks', async () => {
        await seedTemplate();
        const { docId } = await createNoteFromTemplateInDb({
            templateDocId: TEMPLATE_ID,
            title: '2026-07-17',
            folderId: 'main',
            dateString: '2026-07-17',
        });
        const blocks = await loadFragment(docId);
        expect(blockText(blocks[0])).toBe('Journal 2026-07-17');
        const boldRun = (blocks[2].toArray()[0] as Y.XmlText).toDelta() as Array<{
            insert: string;
            attributes?: Record<string, unknown>;
        }>;
        expect(boldRun.map((op) => op.insert).join('')).toBe('Logged 2026-07-17');
        expect(boldRun[0].attributes).toHaveProperty('bold');
        // Search index gets the substituted plain text
        const entry = await getSearchIndexEntry(docId);
        expect(entry?.plainTextContent).toContain('Logged 2026-07-17');
        expect(entry?.plainTextContent).not.toContain('{{date}}');
    });

    it('leaves the template document itself untouched', async () => {
        await seedTemplate();
        await createNoteFromTemplateInDb({
            templateDocId: TEMPLATE_ID,
            title: '2026-07-17',
            folderId: 'main',
            dateString: '2026-07-17',
        });
        const templateBlocks = await loadFragment(TEMPLATE_ID);
        expect(blockText(templateBlocks[0])).toBe('Journal {{date}}');
    });

    it('falls back to plain-content creation when the template has no stored updates', async () => {
        const now = new Date().toISOString();
        await upsertSearchIndex({
            docId: TEMPLATE_ID,
            title: 'Daily template',
            plainTextContent: '# {{date}}\n\nnotes',
            metadata: {
                title: 'Daily template',
                folderId: 'main',
                tags: [],
                timestamps: { created: now, modified: now },
                excludeFromAI: false,
            },
        });
        const { docId } = await createNoteFromTemplateInDb({
            templateDocId: TEMPLATE_ID,
            title: '2026-07-17',
            folderId: 'main',
            dateString: '2026-07-17',
        });
        const blocks = await loadFragment(docId);
        expect(blocks[0].nodeName).toBe('heading');
        expect(blockText(blocks[0])).toBe('2026-07-17');
    });
});
