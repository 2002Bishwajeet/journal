import { useEffect, useState, useCallback, useRef, useDeferredValue } from "react";
import { advancedSearch, getAllDocuments } from "@/lib/db";
import type { SearchIndexEntry, AdvancedSearchResult } from "@/types";
import {
    applyRecentBoost,
    loadRecentNotes,
    loadRecentSearches,
    pushRecentSearch,
    removeRecentNote,
    removeRecentSearch,
    resolveRecentNotes,
    saveRecentNotes,
    saveRecentSearches,
} from "@/lib/recentItems";

// Type for results - either basic search index entry or advanced result with highlights
export type SearchResult = SearchIndexEntry | AdvancedSearchResult;

export function isAdvancedResult(result: SearchResult): result is AdvancedSearchResult {
    return 'matchType' in result;
}

/** One row of the flat list the arrow keys walk, in display order. */
export type SearchEntry =
    | { kind: 'note'; section: 'recent' | 'notes'; result: SearchResult }
    | { kind: 'search'; section: 'searches'; text: string };

export interface UseSearchModalOptions {
    isOpen: boolean;
    onClose: () => void;
    onSelectNote: (docId: string) => void;
}

export interface UseSearchModalReturn {
    // State
    query: string;
    entries: SearchEntry[];
    selectedIndex: number;
    isLoading: boolean;
    inputRef: React.RefObject<HTMLInputElement | null>;

    // Handlers
    handleQueryChange: (value: string) => void;
    handleKeyDown: (e: React.KeyboardEvent) => void;
    handleClose: () => void;
    handleSelectResult: (docId: string) => void;
    setSelectedIndex: (index: number) => void;
    handleSelectEntry: (entry: SearchEntry) => void;
    handleRemoveEntry: (entry: SearchEntry) => void;
    handleClearRecents: () => void;
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
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [recentNotes, setRecentNotes] = useState(loadRecentNotes);
    const [recentSearches, setRecentSearches] = useState(loadRecentSearches);
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
            // A query is worth remembering once it led to a note.
            if (trimmedQuery) saveRecentSearches(pushRecentSearch(loadRecentSearches(), trimmedQuery));
            onSelectNote(docId);
            handleClose();
        },
        [onSelectNote, handleClose, trimmedQuery]
    );

    const handleQueryChange = useCallback((value: string) => {
        const nextTrimmed = value.trim();
        setPendingQuery(nextTrimmed ? nextTrimmed : null);
        setQuery(value);
        setSelectedIndex(0);
    }, []);

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
            // Notes opened since the modal last opened.
            setRecentNotes(loadRecentNotes());
            setRecentSearches(loadRecentSearches());
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
            setResults(applyRecentBoost(searchResults, loadRecentNotes().map((n) => n.docId)));
            setSelectedIndex(0);
        }, 150);

        return () => {
            cancelled = true;
            clearTimeout(debounce);
        };
    }, [query, isOpen]);

    const deferredResults = useDeferredValue(results);

    let entries: SearchEntry[];
    if (trimmedQuery) {
        entries = deferredResults.map((result) => ({ kind: 'note', section: 'notes', result }));
    } else {
        const recent = resolveRecentNotes(recentNotes, deferredResults);
        const recentIds = new Set(recent.map((r) => r.docId));
        entries = [
            ...recent.map((result): SearchEntry => ({ kind: 'note', section: 'recent', result })),
            ...recentSearches.map((text): SearchEntry => ({ kind: 'search', section: 'searches', text })),
            ...deferredResults
                .filter((r) => !recentIds.has(r.docId))
                .map((result): SearchEntry => ({ kind: 'note', section: 'notes', result })),
        ];
    }

    const handleSelectEntry = useCallback(
        (entry: SearchEntry) => {
            if (entry.kind === 'search') handleQueryChange(entry.text);
            else handleSelectResult(entry.result.docId);
        },
        [handleQueryChange, handleSelectResult]
    );

    const handleRemoveEntry = useCallback((entry: SearchEntry) => {
        if (entry.kind === 'search') {
            const next = removeRecentSearch(loadRecentSearches(), entry.text);
            saveRecentSearches(next);
            setRecentSearches(next);
        } else {
            const next = removeRecentNote(loadRecentNotes(), entry.result.docId);
            saveRecentNotes(next);
            setRecentNotes(next);
        }
    }, []);

    const handleClearRecents = useCallback(() => {
        saveRecentNotes([]);
        saveRecentSearches([]);
        setRecentNotes([]);
        setRecentSearches([]);
    }, []);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            switch (e.key) {
                case "ArrowDown": {
                    e.preventDefault();
                    if (entries.length === 0) return;
                    const nextIndex = Math.min(selectedIndex + 1, entries.length - 1);
                    setSelectedIndex(nextIndex);

                    // Scroll active item into view
                    const nextEl = document.getElementById(`search-result-${nextIndex}`);
                    nextEl?.scrollIntoView({ block: 'nearest' });
                    break;
                }
                case "ArrowUp": {
                    e.preventDefault();
                    if (entries.length === 0) return;
                    const prevIndex = Math.max(selectedIndex - 1, 0);
                    setSelectedIndex(prevIndex);

                    // Scroll active item into view
                    const prevEl = document.getElementById(`search-result-${prevIndex}`);
                    prevEl?.scrollIntoView({ block: 'nearest' });
                    break;
                }
                case "Enter":
                    e.preventDefault();
                    if (entries[selectedIndex]) {
                        handleSelectEntry(entries[selectedIndex]);
                    }
                    break;
                case "Escape":
                    e.preventDefault();
                    handleClose();
                    break;
            }
        },
        [entries, selectedIndex, handleSelectEntry, handleClose]
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
        entries,
        selectedIndex,
        isLoading,
        inputRef,
        handleQueryChange,
        handleKeyDown,
        handleClose,
        handleSelectResult,
        setSelectedIndex,
        handleSelectEntry,
        handleRemoveEntry,
        handleClearRecents,
    };
}
