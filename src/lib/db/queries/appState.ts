import { getDatabase } from '../pglite';

// App State persistence
export async function saveAppState(key: string, value: unknown): Promise<void> {
    const db = await getDatabase();
    await db.query(
        `INSERT INTO app_state (key, value, updated_at) 
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (key) DO UPDATE SET 
            value = EXCLUDED.value, 
            updated_at = CURRENT_TIMESTAMP`,
        [key, JSON.stringify(value)]
    );
}

export async function getAppState<T>(key: string): Promise<T | null> {
    const db = await getDatabase();
    const result = await db.query<{ value: T }>(
        'SELECT value FROM app_state WHERE key = $1',
        [key]
    );
    if (result.rows.length === 0) return null;
    return result.rows[0].value;
}
