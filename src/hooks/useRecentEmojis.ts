
import { useState, useCallback } from 'react';

const STORAGE_KEY = 'journal-recent-emojis';
const MAX_RECENTS = 28; // 4 rows of 7

export function useRecentEmojis() {
    // Use lazy initialization to read from localStorage synchronously
    const [recents, setRecents] = useState<string[]>(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.error('Failed to parse recent emojis', e);
            return [];
        }
    });

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
