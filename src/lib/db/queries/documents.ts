import * as Y from 'yjs';
import { getDatabase } from '../pglite';
import type { SearchIndexEntry, DocumentMetadata, SnapshotMeta } from '@/types';

// Document Updates (Yjs blobs)
export async function saveDocumentUpdate(docId: string, updateBlob: Uint8Array): Promise<void> {
    const db = await getDatabase();
    await db.query(
        'INSERT INTO document_updates (doc_id, update_blob) VALUES ($1, $2)',
        [docId, updateBlob]
    );
}

export async function getDocumentUpdates(docId: string): Promise<Uint8Array[]> {
    const db = await getDatabase();
    const result = await db.query<{ update_blob: Uint8Array }>(
        'SELECT update_blob FROM document_updates WHERE doc_id = $1 ORDER BY created_at ASC',
        [docId]
    );
    return result.rows.map(row => row.update_blob);
}

export async function deleteDocumentUpdates(docId: string): Promise<void> {
    const db = await getDatabase();
    await db.query('DELETE FROM document_updates WHERE doc_id = $1', [docId]);
}

// Atomically replace all of a doc's updates with a single compacted blob. The
// delete and insert run in ONE statement (a data-modifying CTE), so a crash or
// error between them can never leave the note with zero rows — the note's local
// history survives intact. Replaces the old non-atomic delete→save pairs.
// The stored rows are merged into the blob and only those rows are deleted, so
// an update another tab saved after the caller built `blob` is never lost (#264).
export async function replaceDocumentUpdates(docId: string, blob: Uint8Array): Promise<void> {
    const db = await getDatabase();
    const stored = await db.query<{ id: number; update_blob: Uint8Array }>(
        'SELECT id, update_blob FROM document_updates WHERE doc_id = $1',
        [docId]
    );
    const merged = new Y.Doc();
    for (const row of stored.rows) Y.applyUpdate(merged, row.update_blob);
    Y.applyUpdate(merged, blob);
    await db.query(
        `WITH del AS (DELETE FROM document_updates WHERE doc_id = $1 AND id = ANY($3::int[]))
         INSERT INTO document_updates (doc_id, update_blob) VALUES ($1, $2)`,
        [docId, Y.encodeStateAsUpdate(merged), stored.rows.map(row => row.id)]
    );
    merged.destroy();
}

// Version history snapshots (local only, never synced)
export async function saveSnapshot(
    docId: string,
    snap: { stateBlob: Uint8Array; stateVector: Uint8Array; preview: string; wordCount: number }
): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `INSERT INTO document_snapshots (doc_id, state_blob, state_vector, preview, word_count)
         VALUES ($1, $2, $3, $4, $5)`,
        [docId, snap.stateBlob, snap.stateVector, snap.preview, snap.wordCount]
    );
}

export async function getSnapshots(docId: string): Promise<SnapshotMeta[]> {
    const db = await getDatabase();
    const result = await db.query<{ id: number; preview: string; word_count: number; created_at: Date }>(
        `SELECT id, preview, word_count, created_at FROM document_snapshots
         WHERE doc_id = $1 ORDER BY created_at DESC, id DESC`,
        [docId]
    );
    return result.rows.map(row => ({
        id: row.id,
        preview: row.preview,
        wordCount: row.word_count,
        createdAt: row.created_at,
    }));
}

export async function getLatestSnapshotVector(
    docId: string
): Promise<{ createdAt: Date; stateVector: Uint8Array } | null> {
    const db = await getDatabase();
    const result = await db.query<{ created_at: Date; state_vector: Uint8Array }>(
        `SELECT created_at, state_vector FROM document_snapshots
         WHERE doc_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`,
        [docId]
    );
    const row = result.rows[0];
    return row ? { createdAt: row.created_at, stateVector: row.state_vector } : null;
}

export async function getSnapshotBlob(id: number): Promise<Uint8Array | null> {
    const db = await getDatabase();
    const result = await db.query<{ state_blob: Uint8Array }>(
        'SELECT state_blob FROM document_snapshots WHERE id = $1',
        [id]
    );
    return result.rows[0]?.state_blob ?? null;
}

export async function deleteSnapshots(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await getDatabase();
    await db.query('DELETE FROM document_snapshots WHERE id = ANY($1::int[])', [ids]);
}

// Search Index
export async function upsertSearchIndex(entry: SearchIndexEntry): Promise<void> {
    const db = await getDatabase();

    try {
        // Try the full insert with search_vector (for databases with FTS enabled)
        await db.query(
            `INSERT INTO search_index (doc_id, title, plain_text_content, metadata, search_vector, updated_at)
         VALUES ($1, $2, $3, $4, 
           setweight(to_tsvector('english', COALESCE($2, '')), 'A') ||
           setweight(to_tsvector('english', COALESCE($3, '')), 'B'),
           CURRENT_TIMESTAMP)
         ON CONFLICT (doc_id) DO UPDATE SET
           title = EXCLUDED.title,
           plain_text_content = EXCLUDED.plain_text_content,
           metadata = EXCLUDED.metadata,
           search_vector = EXCLUDED.search_vector,
           updated_at = CURRENT_TIMESTAMP`,
            [entry.docId, entry.title, entry.plainTextContent, JSON.stringify(entry.metadata)]
        );
    } catch (error) {
        // Fallback: insert without search_vector for legacy databases
        // This can happen if migration hasn't run yet
        console.warn('[upsertSearchIndex] Falling back to basic insert (search_vector column may not exist yet):', error);
        await db.query(
            `INSERT INTO search_index (doc_id, title, plain_text_content, metadata, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (doc_id) DO UPDATE SET
           title = EXCLUDED.title,
           plain_text_content = EXCLUDED.plain_text_content,
           metadata = EXCLUDED.metadata,
           updated_at = CURRENT_TIMESTAMP`,
            [entry.docId, entry.title, entry.plainTextContent, JSON.stringify(entry.metadata)]
        );
    }
}

/**
 * Update only metadata fields in search_index — does NOT touch plain_text_content.
 * Use this for metadata-only mutations (title change, pin toggle, etc.)
 * to avoid overwriting full content with a truncated preview.
 */
export async function updateSearchIndexMetadata(
    docId: string,
    title: string,
    metadata: DocumentMetadata,
): Promise<void> {
    const db = await getDatabase();
    // Two keys are not owned by metadata-only writers, so a stale snapshot must not
    // drop them (jsonb overlays on top of the incoming payload):
    //  - `linkedNoteIds` is editor-owned (written only by the content-save path);
    //    the row's value always wins.
    //  - `isPublic` mirrors the remote ACL. Dropping it silently re-encrypts the note
    //    and revokes the public share on the next push (#79), so it survives only when
    //    the writer omitted the key entirely — an explicit value (incl. false) wins.
    await db.query(
        `UPDATE search_index
         SET title = $2,
             metadata = $3::jsonb
               || (CASE WHEN metadata ? 'linkedNoteIds'
                        THEN jsonb_build_object('linkedNoteIds', metadata->'linkedNoteIds')
                        ELSE '{}'::jsonb END)
               || (CASE WHEN metadata ? 'isPublic' AND NOT ($3::jsonb ? 'isPublic')
                        THEN jsonb_build_object('isPublic', metadata->'isPublic')
                        ELSE '{}'::jsonb END),
             search_vector = setweight(to_tsvector('english', COALESCE($2, '')), 'A') ||
                             setweight(to_tsvector('english', COALESCE(plain_text_content, '')), 'B'),
             updated_at = CURRENT_TIMESTAMP
         WHERE doc_id = $1`,
        [docId, title, JSON.stringify(metadata)]
    );
}

export async function getSearchIndexEntry(docId: string): Promise<SearchIndexEntry | null> {
    const db = await getDatabase();
    const result = await db.query<{
        doc_id: string;
        title: string;
        plain_text_content: string;
        metadata: DocumentMetadata;
    }>(
        'SELECT doc_id, title, plain_text_content, metadata FROM search_index WHERE doc_id = $1',
        [docId]
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
        docId: row.doc_id,
        title: row.title,
        plainTextContent: row.plain_text_content,
        metadata: row.metadata,
    };
}

export async function getAllDocuments(): Promise<SearchIndexEntry[]> {
    const db = await getDatabase();
    const result = await db.query<{
        doc_id: string;
        title: string;
        plain_text_content: string;
        metadata: DocumentMetadata;
    }>(
        `SELECT doc_id, title, plain_text_content, metadata FROM search_index 
     ORDER BY (metadata->'timestamps'->>'modified')::timestamp DESC NULLS LAST`
    );
    return result.rows.map(row => ({
        docId: row.doc_id,
        title: row.title,
        plainTextContent: row.plain_text_content,
        metadata: row.metadata,
    }));
}

export async function deleteSearchIndexEntry(docId: string): Promise<void> {
    const db = await getDatabase();
    await db.query('DELETE FROM search_index WHERE doc_id = $1', [docId]);
}

/**
 * Update only the archivalStatus on a note's local metadata (0 active, 2 trashed),
 * preserving every other metadata field.
 */
export async function setNoteArchivalStatusLocal(docId: string, status: number): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `UPDATE search_index
         SET metadata = jsonb_set(metadata, '{archivalStatus}', to_jsonb($2::int)),
             updated_at = CURRENT_TIMESTAMP
         WHERE doc_id = $1`,
        [docId, status]
    );
}

/** Set a note's folderId locally, preserving every other metadata field. */
export async function setNoteFolderLocal(docId: string, folderId: string, expectedFolderId: string): Promise<void> {
    const db = await getDatabase();
    // Only if the folder is still expectedFolderId, so a concurrent local move wins
    await db.query(
        `UPDATE search_index
         SET metadata = jsonb_set(metadata, '{folderId}', to_jsonb($2::text)),
             updated_at = CURRENT_TIMESTAMP
         WHERE doc_id = $1 AND metadata->>'folderId' = $3`,
        [docId, folderId, expectedFolderId]
    );
}
