/**
 * "Save a copy" (#411): copySharedNote turns a public note's markdown into a
 * new note in the caller's own Journal. The drive read is stubbed at the
 * provider boundary; PGlite and Yjs are real.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { createTestDatabase, closeTestDatabase, resetTestDatabase } from './testDb';

vi.mock('@/lib/db/pglite', () => import('./pgliteMock'));
import { setTestDb } from './pgliteMock';
import { getSearchIndexEntry } from '@/lib/db/queries';
import { loadLocalYDoc } from '@/lib/yjs/loadDoc';
import { editorSchema } from '@/lib/agent/editEngine';
import { MAIN_FOLDER_ID } from '@/lib/homebase';

vi.mock('@/lib/providers/ShareProvider', () => ({ shareProvider: { getPublicNote: vi.fn() } }));
import { shareProvider, type SharedNoteData } from '@/lib/providers/ShareProvider';
import { copySharedNote, isValidShareLink } from '@/hooks/useSaveSharedNote';

const IDENTITY = 'author.example.com';
const FILE = '4e9a1c70-3b5d-4f28-a6c1-9d0e2b7f5a34';
const ORIGIN = 'https://journal.example.com';

const HTML = '<style>p{color:red}</style>\n<p id="x">hi</p>\n<script>document.getElementById("x").textContent = "ran";</script>';
const MARKDOWN = [
    'Intro paragraph',
    '```mermaid\ngraph LR\n  A --> B\n```',
    '```html\n' + HTML + '\n```',
    '> [!tip]\n> A callout body',
    '<details>\n<summary>More</summary>\n\nHidden text\n\n</details>',
].join('\n\n');

const sharedNote = (content: string): SharedNoteData => ({
    title: 'Shared thing',
    content,
    fileId: 'file-id',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
});

type Block = { type: string; attrs?: Record<string, unknown>; content?: { type: string; text?: string }[] };
const text = (block: Block) => block.content?.map((n) => n.text ?? '').join('') ?? '';

let db: Awaited<ReturnType<typeof createTestDatabase>>;
beforeAll(async () => {
    db = await createTestDatabase();
    setTestDb(db);
});
afterAll(async () => { await closeTestDatabase(); });
beforeEach(async () => {
    await resetTestDatabase();
    vi.mocked(shareProvider.getPublicNote).mockReset();
});

async function savedContent(docId: string): Promise<Block[]> {
    const ydoc = await loadLocalYDoc(docId);
    return yXmlFragmentToProseMirrorRootNode(ydoc!.getXmlFragment('prosemirror'), editorSchema).toJSON().content;
}

describe('copySharedNote', () => {
    it('saves a new note titled "{title} (copy)" in the default folder', async () => {
        vi.mocked(shareProvider.getPublicNote).mockResolvedValue(sharedNote('Hello'));
        const copy = await copySharedNote(IDENTITY, FILE, ORIGIN);
        expect(shareProvider.getPublicNote).toHaveBeenCalledWith(IDENTITY, FILE);
        expect(copy).toMatchObject({ title: 'Shared thing (copy)', folderId: MAIN_FOLDER_ID, hadImages: false });
        const entry = await getSearchIndexEntry(copy.docId);
        expect(entry?.title).toBe('Shared thing (copy)');
    });

    it('opens with a "Copied from {share URL}" line, then the note text', async () => {
        vi.mocked(shareProvider.getPublicNote).mockResolvedValue(sharedNote('Hello there'));
        const { docId } = await copySharedNote(IDENTITY, FILE, ORIGIN);
        const [first, second] = await savedContent(docId);
        expect(first.type).toBe('paragraph');
        expect(text(first)).toBe(`Copied from ${ORIGIN}/share/${IDENTITY}/${FILE}`);
        expect(text(second)).toBe('Hello there');
    });

    it('turns mermaid, html, callout and toggle markdown into real nodes', async () => {
        vi.mocked(shareProvider.getPublicNote).mockResolvedValue(sharedNote(MARKDOWN));
        const { docId } = await copySharedNote(IDENTITY, FILE, ORIGIN);
        const blocks = await savedContent(docId);

        const code = blocks.filter((b) => b.type === 'codeBlock');
        expect(code.map((b) => b.attrs?.language)).toEqual(['mermaid', 'html']);
        expect(text(code[1])).toBe(HTML);
        expect(blocks.find((b) => b.type === 'callout')?.attrs).toMatchObject({ variant: 'tip' });
        expect(blocks.find((b) => b.type === 'toggle')?.attrs).toMatchObject({ summary: 'More' });
        // Nothing is left as literal markdown text.
        const literal = blocks.filter((b) => b.type === 'paragraph').map(text).join('\n');
        expect(literal).not.toMatch(/\[!tip\]|<details>/);
    });

    it('keeps the alt text of attachment images and says the note had images', async () => {
        vi.mocked(shareProvider.getPublicNote).mockResolvedValue(
            sharedNote(`Before\n\n![A red bike](attachment://${FILE}/jrnl_img1)`),
        );
        const copy = await copySharedNote(IDENTITY, FILE, ORIGIN);
        expect(copy.hadImages).toBe(true);
        const entry = await getSearchIndexEntry(copy.docId);
        expect(entry?.plainTextContent).toContain('A red bike');
        const ydoc = await loadLocalYDoc(copy.docId);
        expect(ydoc!.getXmlFragment('prosemirror').toString()).not.toContain('attachment://');
    });

    it('saves twice as two separate notes', async () => {
        vi.mocked(shareProvider.getPublicNote).mockResolvedValue(sharedNote('Hello'));
        const a = await copySharedNote(IDENTITY, FILE, ORIGIN);
        const b = await copySharedNote(IDENTITY, FILE, ORIGIN);
        expect(a.docId).not.toBe(b.docId);
    });

    it('creates nothing when the note is not shared any more', async () => {
        vi.mocked(shareProvider.getPublicNote).mockResolvedValue(null);
        await expect(copySharedNote(IDENTITY, FILE, ORIGIN)).rejects.toThrow(/not shared/);
        const result = await db.query('SELECT count(*)::int AS n FROM search_index');
        expect((result.rows[0] as { n: number }).n).toBe(0);
    });
});

describe('isValidShareLink', () => {
    it('accepts an identity and a note guid', () => {
        expect(isValidShareLink(IDENTITY, FILE)).toBe(true);
    });

    it.each([
        [null, FILE],
        [IDENTITY, null],
        ['', FILE],
        ['not an identity', FILE],
        ['evil.com/path', FILE],
        [IDENTITY, 'not-a-guid'],
    ])('rejects identity %s with file %s', (identity, file) => {
        expect(isValidShareLink(identity, file)).toBe(false);
    });
});
