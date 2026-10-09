// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import { yXmlFragmentToProseMirrorRootNode } from 'y-prosemirror';
import { editorSchema, toMarkdown } from '@/lib/agent/editEngine';

const { saveDocumentUpdate, upsertSearchIndex } = vi.hoisted(() => ({
    saveDocumentUpdate: vi.fn(),
    upsertSearchIndex: vi.fn(),
}));
vi.mock('@/lib/db/queries', () => ({
    getAllFolders: vi.fn().mockResolvedValue([]),
    upsertSyncRecord: vi.fn(),
    saveDocumentUpdate,
    upsertSearchIndex,
    createFolder: vi.fn(),
}));

import { ImportService } from '@/lib/importexport/ImportService';

const MD = [
    '---',
    'title: "Imported title"',
    '---',
    '# Heading',
    '',
    '- one',
    '- two',
    '',
    '```ts',
    'const a = 1;',
    '```',
    '',
    'Claim[^1].',
    '',
    '[^1]: The note.',
    '',
].join('\n');

describe('markdown import', () => {
    it('parses headings, lists, code and footnotes into real nodes and keeps the frontmatter title', async () => {
        const result = await ImportService.importFiles([new File([MD], 'x.md', { type: 'text/markdown' })]);
        expect(result.imported).toBe(1);
        expect(upsertSearchIndex.mock.calls[0][0].title).toBe('Imported title');

        const ydoc = new Y.Doc();
        Y.applyUpdate(ydoc, saveDocumentUpdate.mock.calls[0][1] as Uint8Array);
        const root = yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment('prosemirror'), editorSchema);
        const names = new Set<string>();
        root.descendants((n) => { names.add(n.type.name); });
        expect(names).toContain('heading');
        expect(names).toContain('bulletList');
        expect(names).toContain('codeBlock');
        expect([...names].some((n) => n.toLowerCase().includes('footnote'))).toBe(true);

        const md = toMarkdown(ydoc);
        expect(md).toContain('# Heading');
        expect(md).toContain('- one');
        expect(md).toContain('[^1]');
        expect(md).toContain('The note.');
    });
});
