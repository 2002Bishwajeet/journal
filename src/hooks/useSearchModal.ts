import { useEffect, useState, useCallback, useRef } from "react";
import { advancedSearch, getAllDocuments } from "@/lib/db";
import { isIndexingInProgress } from "@/lib/workers";
import type { SearchIndexEntry, AdvancedSearchResult } from "@/types";

// Type for results - either basic search index entry or advanced result with highlights
export type SearchResult = SearchIndexEntry | AdvancedSearchResult;

export function isAdvancedResult(result: SearchResult): result is AdvancedSearchResult {
    return 'matchType' in result;
}

export interface UseSearchModalOptions {
    isOpen: boolean;
    onClose: () => void;
    onSelectNote: (docId: string) => void;
}

export interface UseSearchModalReturn {
    // State
    query: string;
    results: SearchResult[];
    selectedIndex: number;
    isLoading: boolean;
    isIndexing: boolean;
    trimmedQuery: string;
    inputRef: React.RefObject<HTMLInputElement | null>;

    // Handlers
    handleQueryChange: (value: string) => void;
    handleKeyDown: (e: React.KeyboardEvent) => void;
    handleClose: () => void;
    handleSelectResult: (docId: string) => void;
    setSelectedIndex: (index: number) => void;
}

export function useSearchModal({
    isOpen,
    onClose,
    onSelectNote,
}: UseSearchModalOptions): UseSearchModalReturn {
    const [query, setQuery] = useState("");
    const [results, setResults] = useState<SearchResult[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [pendingQuery, setPendingQuery] = useState<string | null>(null);
    const [isIndexing, setIsIndexing] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const requestSeqRef = useRef(0);

    const trimmedQuery = query.trim();
    const isLoading = Boolean(
        pendingQuery && pendingQuery === trimmedQuery && trimmedQuery
    );

    const handleClose = useCallback(() => {
        setQuery("");
        setResults([]);
        setSelectedIndex(0);
        setPendingQuery(null);
        onClose();
    }, [onClose]);

    const handleSelectResult = useCallback(
        (docId: string) => {
            onSelectNote(docId);
            handleClose();
        },
        [onSelectNote, handleClose]
    );

    const handleQueryChange = useCallback((value: string) => {
        const nextTrimmed = value.trim();
        setPendingQuery(nextTrimmed ? nextTrimmed : null);
        setQuery(value);
        setSelectedIndex(0);
    }, []);

    // Check indexing status
    useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;

        const checkIndexing = async () => {
            try {
                const indexing = await isIndexingInProgress();
                if (!cancelled) {
                    setIsIndexing(indexing);
                }
            } catch {
                // Ignore errors during indexing check
            }
        };

        checkIndexing();
        const interval = setInterval(checkIndexing, 2000);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [isOpen]);

    // Focus input when modal opens
    useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;
        // Small timeout to ensure render is complete
        const timer = setTimeout(() => {
            inputRef.current?.focus();
        }, 10);

        // Load all notes initially
        (async () => {
            const docs = await getAllDocuments();
            if (cancelled) return;
            setResults(docs);
        })();

        return () => {
            cancelled = true;
            clearTimeout(timer);
        };
    }, [isOpen]);

    // Search on query change
    useEffect(() => {
        if (!isOpen) return;

        const trimmed = query.trim();
        const requestSeq = ++requestSeqRef.current;
        let cancelled = false;

        if (!trimmed) {
            (async () => {
                const docs = await getAllDocuments();
                if (cancelled || requestSeqRef.current !== requestSeq) return;
                setResults(docs);
                setSelectedIndex(0);
            })();
            return () => {
                cancelled = true;
            };
        }

        const debounce = setTimeout(async () => {
            // Use advanced search with FTS, fuzzy matching, and highlighting
            const searchResults = await advancedSearch(trimmed);
            if (cancelled || requestSeqRef.current !== requestSeq) return;
            setPendingQuery((current) => (current === trimmed ? null : current));
            setResults(searchResults);
            setSelectedIndex(0);
        }, 150);

        return () => {
            cancelled = true;
            clearTimeout(debounce);
        };
    }, [query, isOpen]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            switch (e.key) {
                case "ArrowDown": {
                    e.preventDefault();
                    if (results.length === 0) return;
                    const nextIndex = Math.min(selectedIndex + 1, results.length - 1);
                    setSelectedIndex(nextIndex);

                    // Scroll active item into view
                    const nextEl = document.getElementById(`search-result-${nextIndex}`);
                    nextEl?.scrollIntoView({ block: 'nearest' });
                    break;
                }
                case "ArrowUp": {
                    e.preventDefault();
                    if (results.length === 0) return;
                    const prevIndex = Math.max(selectedIndex - 1, 0);
                    setSelectedIndex(prevIndex);

                    // Scroll active item into view
                    const prevEl = document.getElementById(`search-result-${prevIndex}`);
                    prevEl?.scrollIntoView({ block: 'nearest' });
                    break;
                }
                case "Enter":
                    e.preventDefault();
                    if (results[selectedIndex]) {
                        handleSelectResult(results[selectedIndex].docId);
                    }
                    break;
                case "Escape":
                    e.preventDefault();
                    handleClose();
                    break;
            }
        },
        [results, selectedIndex, handleSelectResult, handleClose]
    );

    // Handle keyboard shortcut (Cmd+K or Ctrl+K)
    useEffect(() => {
        const handleGlobalKeyDown = (e: KeyboardEvent) => {
            // Cmd+K or Ctrl+K to open search
            if ((e.metaKey || e.ctrlKey) && e.key === "k") {
                e.preventDefault();
                // This is handled by parent component
            }
        };

        window.addEventListener("keydown", handleGlobalKeyDown);
        return () => window.removeEventListener("keydown", handleGlobalKeyDown);
    }, []);

    return {
        query,
        results,
        selectedIndex,
        isLoading,
        isIndexing,
        trimmedQuery,
        inputRef,
        handleQueryChange,
        handleKeyDown,
        handleClose,
        handleSelectResult,
        setSelectedIndex,
    };
}
