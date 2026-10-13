import { MAIN_FOLDER_ID } from '../../homebase';
import { getDatabase } from '../pglite';
import type { Folder } from '@/types';
import { toFolder, type FolderRow } from './noteList';

// Folders
export async function getAllFolders(): Promise<Folder[]> {
    const db = await getDatabase();
    const result = await db.query<FolderRow>('SELECT id, name, created_at, is_public FROM folders ORDER BY name ASC');
    return result.rows.map(toFolder);
}

export async function getFolderById(id: string): Promise<Folder | null> {
    const db = await getDatabase();
    const result = await db.query<FolderRow>('SELECT id, name, created_at, is_public FROM folders WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    return toFolder(result.rows[0]);
}

/**
 * Find a folder by exact name, returning the first-created match when several
 * share a name (folder names are not unique — see the find-or-create-folder
 * conventions for `Daily` and `Templates`).
 */
export async function getFolderByName(name: string): Promise<Folder | null> {
    const db = await getDatabase();
    const result = await db.query<FolderRow>('SELECT id, name, created_at, is_public FROM folders WHERE name = $1 ORDER BY created_at ASC LIMIT 1', [name]);
    if (result.rows.length === 0) return null;
    return toFolder(result.rows[0]);
}

export async function createFolder(id: string, name: string): Promise<void> {
    const db = await getDatabase();
    await db.query(
        'INSERT INTO folders (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [id, name]
    );
}

/** Insert or rename a folder. Remote sync only — local creates use createFolder. */
export async function upsertFolder(id: string, name: string, isPublic = false): Promise<void> {
    const db = await getDatabase();
    await db.query(
        'INSERT INTO folders (id, name, is_public) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, is_public = EXCLUDED.is_public',
        [id, name, isPublic]
    );
}

/** Share or unshare a folder locally (#618); the caller marks it pending so the flag syncs. */
export async function setFolderPublicLocal(id: string, isPublic: boolean): Promise<void> {
    const db = await getDatabase();
    await db.query('UPDATE folders SET is_public = $2 WHERE id = $1', [id, isPublic]);
}

/** Whether `id` names a shared folder (#618). Compared as text: a note's folderId isn't always a UUID. */
export async function isFolderPublic(id: string): Promise<boolean> {
    const db = await getDatabase();
    const result = await db.query<{ is_public: boolean }>('SELECT is_public FROM folders WHERE id::text = $1', [id]);
    return result.rows[0]?.is_public === true;
}

/** The non-trashed notes in a folder whose public flag is not `isPublic`: what sharing or unsharing it changes. */
export async function getFolderNotesToShare(folderId: string, isPublic: boolean): Promise<string[]> {
    const db = await getDatabase();
    const result = await db.query<{ doc_id: string }>(
        `SELECT doc_id FROM search_index
         WHERE metadata->>'folderId' = $1
           AND COALESCE((metadata->>'archivalStatus')::int, 0) <> 2
           AND COALESCE((metadata->>'isPublic')::boolean, false) <> $2
         ORDER BY (metadata->'timestamps'->>'modified') DESC`,
        [folderId, isPublic]
    );
    return result.rows.map(row => row.doc_id);
}

export async function deleteFolder(id: string): Promise<void> {
    // Prevent deleting the Main folder
    if (id === MAIN_FOLDER_ID) {
        throw new Error('Cannot delete the Main folder');
    }
    const db = await getDatabase();
    await db.query('DELETE FROM folders WHERE id = $1', [id]);
}
