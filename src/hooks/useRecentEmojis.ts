
import { useState, useCallback, useEffect } from 'react';

const STORAGE_KEY = 'journal-recent-emojis';
const MAX_RECENTS = 28; // 4 rows of 7

export function useRecentEmojis() {
    const [recents, setRecents] = useState<string[]>([]);

    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            try {
                setRecents(JSON.parse(stored));
            } catch (e) {
                console.error('Failed to parse recent emojis', e);
            }
        }
    }, []);

    const addRecent = useCallback((emoji: string) => {
        setRecents((prev) => {
            const newRecents = [emoji, ...prev.filter((e) => e !== emoji)].slice(0, MAX_RECENTS);
            localStorage.setItem(STORAGE_KEY, JSON.stringify(newRecents));
            return newRecents;
        });
    }, []);

    const clearRecents = useCallback(() => {
        setRecents([]);
        localStorage.removeItem(STORAGE_KEY);
    }, []);

    return { recents, addRecent, clearRecents };
}
