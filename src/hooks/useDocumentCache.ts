/**
 * Document Cache Hook
 * 
 * Provides a simple cache to track which documents have been loaded
 * in the current session, enabling faster tab switching by avoiding
 * redundant database loads when the data is already in memory.
 * 
 * Note: The actual Y.Doc state is managed by EditorProvider and PGliteProvider.
 * This cache provides metadata and state tracking for performance optimization.
 */

import { useRef, useCallback } from "react";

interface CachedDocumentMeta {
    docId: string;
    lastAccessed: number;
    isLoaded: boolean;
}

// Maximum number of documents to track
const MAX_CACHE_SIZE = 10;

/**
 * Manages document loading state to avoid redundant loads.
 * Works alongside PGliteProvider which handles actual Y.Doc state.
 */
export function useDocumentCache() {
    const cacheRef = useRef<Map<string, CachedDocumentMeta>>(new Map());

    /**
     * Mark a document as accessed (for LRU tracking).
     */
    const markAccessed = useCallback((docId: string): void => {
        const cache = cacheRef.current;
        const existing = cache.get(docId);

        if (existing) {
            existing.lastAccessed = Date.now();
        } else {
            cache.set(docId, {
                docId,
                lastAccessed: Date.now(),
                isLoaded: false,
            });

            // Evict oldest if over limit
            if (cache.size > MAX_CACHE_SIZE) {
                evictOldest(cache);
            }
        }
    }, []);

    /**
     * Mark a document as fully loaded.
     */
    const markLoaded = useCallback((docId: string): void => {
        const cache = cacheRef.current;
        const existing = cache.get(docId);

        if (existing) {
            existing.isLoaded = true;
            existing.lastAccessed = Date.now();
        } else {
            cache.set(docId, {
                docId,
                lastAccessed: Date.now(),
                isLoaded: true,
            });
        }
    }, []);

    /**
     * Check if a document has been loaded in this session.
     */
    const isDocumentLoaded = useCallback((docId: string): boolean => {
        const cached = cacheRef.current.get(docId);
        return cached?.isLoaded ?? false;
    }, []);

    /**
     * Remove a document from the cache (e.g., when tab is closed).
     */
    const removeFromCache = useCallback((docId: string): void => {
        cacheRef.current.delete(docId);
    }, []);

    /**
     * Get recently accessed document IDs in order.
     */
    const getRecentDocIds = useCallback((): string[] => {
        const entries = Array.from(cacheRef.current.values());
        entries.sort((a, b) => b.lastAccessed - a.lastAccessed);
        return entries.map(e => e.docId);
    }, []);

    /**
     * Clear all documents from the cache.
     */
    const clearCache = useCallback((): void => {
        cacheRef.current.clear();
    }, []);

    return {
        markAccessed,
        markLoaded,
        isDocumentLoaded,
        removeFromCache,
        getRecentDocIds,
        clearCache,
    };
}

/**
 * Evict the oldest document from the cache.
 */
function evictOldest(cache: Map<string, CachedDocumentMeta>): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, value] of cache.entries()) {
        if (value.lastAccessed < oldestTime) {
            oldestTime = value.lastAccessed;
            oldestKey = key;
        }
    }

    if (oldestKey) {
        cache.delete(oldestKey);
    }
}

export default useDocumentCache;
