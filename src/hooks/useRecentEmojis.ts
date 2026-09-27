
import { useState, useCallback } from 'react';
import { RECENT_EMOJIS_KEY, readString, writeString, removeKey } from '@/lib/storage';

const MAX_RECENTS = 28; // 4 rows of 7
const CURRENT_VERSION = 1;

interface StoredRecents {
    _v: number;
    items: string[];
}

function loadRecents(): string[] {
    const raw = readString(RECENT_EMOJIS_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw) as StoredRecents | string[];
        if (Array.isArray(parsed)) {
            const versioned: StoredRecents = { _v: CURRENT_VERSION, items: parsed };
            writeString(RECENT_EMOJIS_KEY, JSON.stringify(versioned));
            return parsed;
        }
        return parsed.items ?? [];
    } catch {
        return [];
    }
}

function saveRecents(items: string[]) {
    const data: StoredRecents = { _v: CURRENT_VERSION, items };
    writeString(RECENT_EMOJIS_KEY, JSON.stringify(data));
}

export function useRecentEmojis() {
    const [recents, setRecents] = useState<string[]>(loadRecents);

    const addRecent = useCallback((emoji: string) => {
        setRecents((prev) => {
            const newRecents = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, MAX_RECENTS);
            saveRecents(newRecents);
            return newRecents;
        });
    }, []);

    const clearRecents = useCallback(() => {
        setRecents([]);
        removeKey(RECENT_EMOJIS_KEY);
    }, []);

    return { recents, addRecent, clearRecents };
}

export { loadRecents, RECENT_EMOJIS_KEY as STORAGE_KEY };
