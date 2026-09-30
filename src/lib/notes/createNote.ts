import * as Y from 'yjs';
import {
    upsertSearchIndex,
    upsertSyncRecord,
    saveDocumentUpdate,
    getSearchIndexEntry,
} from '@/lib/db';
import { getNewId } from '@/lib/utils';
import { extractPreviewTextFromYjs } from '@/lib/yjs-utils';
import { loadLocalYDoc } from '@/lib/yjs/loadDoc';
import { DATE_TOKEN, pushContentBlocks, substituteDateTokens } from '@/lib/yjs/noteContent';
import type { DocumentMetadata } from '@/types';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { formatGuidId } from '@homebase-id/js-lib/helpers';

export interface CreateNoteResult {
    docId: string;
    folderId: string;
}

export interface CreateNoteWithContentParams {
    title: string;
    content: string; // markdown / plain text
    folderId: string;
}

/**
 * Shared persistence tail: save the Yjs blob, index it (plain text derived
 * from the blob itself so search/preview always match the rendered note),
 * queue it for sync.
 */
async function persistNewNote({
    title,
    folderId,
    updateBlob,
}: {
    title: string;
    folderId: string;
    updateBlob: Uint8Array;
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

    const plainTextContent = await extractPreviewTextFromYjs(docId, updateBlob);

    await saveDocumentUpdate(docId, updateBlob);

    await upsertSearchIndex({
        docId,
        title: metadata.title,
        plainTextContent,
        metadata,
    });

    await upsertSyncRecord({
        localId: docId,
        entityType: 'note',
        syncStatus: 'pending',
    });

    return { docId, folderId: metadata.folderId };
}

/**
 * Create a note with initial markdown/plain-text content — the battle-tested
 * path shared by the PWA share target, daily notes, and templates. Kept out of
 * the useNotes mutation so non-list hooks can reuse it directly without each
 * spinning up a redundant active-notes live subscription.
 */
export async function createNoteWithContentInDb({
    title,
    content,
    folderId,
}: CreateNoteWithContentParams): Promise<CreateNoteResult> {
    const ydoc = new Y.Doc();
    pushContentBlocks(ydoc.getXmlFragment('prosemirror'), content);
    const updateBlob = Y.encodeStateAsUpdate(ydoc);
    ydoc.destroy();
    return persistNewNote({ title, folderId, updateBlob });
}

/**
 * Create a note from markdown through the agent edit engine, so live blocks,
 * callouts, toggles, tables and task lists come out as real nodes (the plain
 * path above only knows headings and paragraphs). The engine is imported on
 * demand: it carries the whole extension list.
 */
export async function createNoteFromMarkdownInDb({
    title,
    content,
    folderId,
}: CreateNoteWithContentParams): Promise<CreateNoteResult> {
    const { createDoc } = await import('@/lib/agent/editEngine');
    const ydoc = createDoc(content);
    const updateBlob = Y.encodeStateAsUpdate(ydoc);
    ydoc.destroy();
    return persistNewNote({ title, folderId, updateBlob });
}

interface CreateNoteFromTemplateParams {
    templateDocId: string;
    title: string;
    folderId: string;
    dateString: string; // replaces {{date}} tokens (local YYYY-MM-DD)
}

/**
 * Spawn a note from a template note by copying its stored Yjs document —
 * headings, lists, marks and all — with {{date}} substituted inside text
 * runs. Copying the blob (not the search index's plain-text extract) is what
 * preserves the template's formatting. Falls back to plain-content creation
 * when the template has no local Yjs updates.
 */
export async function createNoteFromTemplateInDb({
    templateDocId,
    title,
    folderId,
    dateString,
}: CreateNoteFromTemplateParams): Promise<CreateNoteResult> {
    const ydoc = await loadLocalYDoc(templateDocId);
    if (!ydoc) {
        const entry = await getSearchIndexEntry(templateDocId);
        const content = (entry?.plainTextContent || '').split(DATE_TOKEN).join(dateString);
        return createNoteWithContentInDb({ title, content, folderId });
    }

    substituteDateTokens(ydoc.getXmlFragment('prosemirror'), dateString);
    const updateBlob = Y.encodeStateAsUpdate(ydoc);
    ydoc.destroy();
    return persistNewNote({ title, folderId, updateBlob });
}
