import { MAIN_FOLDER_ID } from '../../homebase';
import { getDatabase } from '../pglite';
import type { Folder } from '@/types';
import { toFolder } from './noteList';

// Folders
export async function getAllFolders(): Promise<Folder[]> {
    const db = await getDatabase();
    const result = await db.query<{
        id: string;
        name: string;
        created_at: Date;
    }>('SELECT id, name, created_at FROM folders ORDER BY name ASC');
    return result.rows.map(row => ({
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
    }));
}

export async function getFolderById(id: string): Promise<Folder | null> {
    const db = await getDatabase();
    const result = await db.query<{
        id: string;
        name: string;
        created_at: Date;
    }>('SELECT id, name, created_at FROM folders WHERE id = $1', [id]);
    if (result.rows.length === 0) return null;
    const row = result.rows[0];
    return {
        id: row.id,
        name: row.name,
        createdAt: row.created_at,
    };
}

/**
 * Find a folder by exact name, returning the first-created match when several
 * share a name (folder names are not unique — see the find-or-create-folder
 * conventions for `Daily` and `Templates`).
 */
export async function getFolderByName(name: string): Promise<Folder | null> {
    const db = await getDatabase();
    const result = await db.query<{
        id: string;
        name: string;
        created_at: Date;
    }>('SELECT id, name, created_at FROM folders WHERE name = $1 ORDER BY created_at ASC LIMIT 1', [name]);
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
export async function upsertFolder(id: string, name: string): Promise<void> {
    const db = await getDatabase();
    await db.query(
        'INSERT INTO folders (id, name) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name',
        [id, name]
    );
}

export async function deleteFolder(id: string): Promise<void> {
    // Prevent deleting the Main folder
    if (id === MAIN_FOLDER_ID) {
        throw new Error('Cannot delete the Main folder');
    }
    const db = await getDatabase();
    await db.query('DELETE FROM folders WHERE id = $1', [id]);
}
