import { get, set, del } from 'idb-keyval';
import { usesEncryptedDatabase } from '@/lib/db/databaseKey';

/** The react-query cache's idb-keyval key: note lists, titles and snippets, kept 7 days for offline. */
export const QUERY_CACHE_KEY = 'journal-query-cache';

/**
 * Where the query cache persists. The native app seals it with the database's keychain key
 * (#1429, sealed.ts): with the app locked or the key gone, the restore throws and the persister
 * deletes it, so the app starts empty, and writes fail until the database is unlocked. A plain
 * copy an older build left is deleted, never restored. The web keeps it plain, as before.
 */
export function queryCacheStorage(sealed = usesEncryptedDatabase()) {
    if (!sealed) {
        return {
            getItem: (key: string) => get<string>(key),
            setItem: (key: string, value: string) => set(key, value),
            removeItem: (key: string) => del(key),
        };
    }
    return {
        getItem: async (key: string): Promise<string | undefined> => {
            const stored = await get<unknown>(key);
            if (stored === undefined) return undefined;
            if (!(stored instanceof Uint8Array)) {
                await del(key);
                return undefined;
            }
            const { unseal } = await import('@/lib/db/sealed');
            return new TextDecoder().decode(await unseal(stored as Uint8Array<ArrayBuffer>, key));
        },
        setItem: async (key: string, value: string) => {
            const { seal } = await import('@/lib/db/sealed');
            await set(key, await seal(new TextEncoder().encode(value), key));
        },
        removeItem: (key: string) => del(key),
    };
}
