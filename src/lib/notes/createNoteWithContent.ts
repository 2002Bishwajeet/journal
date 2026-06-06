import * as Y from 'yjs';
import { getNewId } from '@/lib/utils';
import { formatGuidId } from '@homebase-id/js-lib/helpers';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { saveDocumentUpdate, upsertSearchIndex, upsertSyncRecord } from '@/lib/db';
import type { DocumentMetadata } from '@/types';

export interface CreateNoteResult {
    docId: string;
    folderId: string;
}

/**
 * Create a note with initial plain-text content, locally-first: write the Yjs
 * document, the search index, and a pending sync record. Shared by the
 * useNotes mutation and the `[[` create-on-the-fly flow so neither has to
 * subscribe to the note list just to create.
 */
export async function createNoteWithContent({
    title,
    content,
    folderId,
}: {
    title: string;
    content: string;
    folderId: string;
}): Promise<CreateNoteResult> {
    const docId = formatGuidId(getNewId());
    const now = new Date().toISOString();

    const metadata: DocumentMetadata = {
        title: title || 'Untitled',
        folderId: folderId || MAIN_FOLDER_ID,
        tags: [],
        timestamps: { created: now, modified: now },
        excludeFromAI: false,
        isPinned: false,
    };

    // Build the Yjs document with the initial paragraph content.
    const ydoc = new Y.Doc();
    const fragment = ydoc.getXmlFragment('prosemirror');
    const paragraph = new Y.XmlElement('paragraph');
    if (content) {
        paragraph.push([new Y.XmlText(content)]);
    }
    fragment.push([paragraph]);
    const updateBlob = Y.encodeStateAsUpdate(ydoc);

    await saveDocumentUpdate(docId, updateBlob);
    await upsertSearchIndex({
        docId,
        title: metadata.title,
        plainTextContent: content,
        metadata,
    });
    await upsertSyncRecord({
        localId: docId,
        entityType: 'note',
        syncStatus: 'pending',
    });

    ydoc.destroy();

    return { docId, folderId: metadata.folderId };
}
