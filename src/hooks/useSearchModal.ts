import { useEffect, useState, useCallback, useRef, useDeferredValue } from "react";
import { advancedSearch, getAllFolders, getNotesByIds, getRecentlyModifiedNotes } from "@/lib/db";
import type { SearchIndexEntry, AdvancedSearchResult, NoteListEntry } from "@/types";
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
import { findTermForResult } from "@/lib/search/findReplace";

// Type for results - either basic search index entry or advanced result with highlights
export type SearchResult = SearchIndexEntry | NoteListEntry | AdvancedSearchResult;

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
    /** `find` is the text to look for in the note once it opens, when the match was in its body. */
    onSelectNote: (docId: string, find?: string) => void;
    initialQuery?: string;
}

export interface UseSearchModalReturn {
    // State
    query: string;
    entries: SearchEntry[];
    selectedIndex: number;
    /** A query is waiting for its results; the rows on screen are from the one before. */
    isLoading: boolean;
    /** Folder names by id, for the rows' meta line. */
    folderNames: Map<string, string>;
    inputRef: React.RefObject<HTMLInputElement | null>;

    // Handlers
    handleQueryChange: (value: string) => void;
    handleKeyDown: (e: React.KeyboardEvent) => void;
    handleClose: () => void;
    handleSelectResult: (docId: string, find?: string) => void;
    setSelectedIndex: (index: number) => void;
    handleSelectEntry: (entry: SearchEntry) => void;
    handleRemoveEntry: (entry: SearchEntry) => void;
    handleClearRecents: () => void;
}

const RECENT_MODIFIED_SHOWN = 30;

export function useSearchModal({
    isOpen,
    onClose,
    onSelectNote,
    initialQuery,
}: UseSearchModalOptions): UseSearchModalReturn {
    const [query, setQuery] = useState("");
    // Rows of the last settled query; null until one has arrived.
    const [results, setResults] = useState<SearchResult[] | null>(null);
    // The empty state, loaded once per open: the recently opened notes and the latest modified ones.
    const [openedNotes, setOpenedNotes] = useState<NoteListEntry[]>([]);
    const [modifiedNotes, setModifiedNotes] = useState<NoteListEntry[]>([]);
    const [folderNames, setFolderNames] = useState(() => new Map<string, string>());
    const selectedDocIdRef = useRef<string | undefined>(undefined);
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
        setResults(null);
        setSelectedIndex(0);
        setPendingQuery(null);
        onClose();
    }, [onClose]);

    const handleSelectResult = useCallback(
        (docId: string, find?: string) => {
            // A query is worth remembering once it led to a note.
            if (trimmedQuery) saveRecentSearches(pushRecentSearch(loadRecentSearches(), trimmedQuery));
            onSelectNote(docId, find);
            handleClose();
        },
        [onSelectNote, handleClose, trimmedQuery]
    );

    const handleQueryChange = useCallback((value: string) => {
        const nextTrimmed = value.trim();
        setPendingQuery(nextTrimmed ? nextTrimmed : null);
        setQuery(value);
        // A query keeps the selection on its note while results change (see below); clearing starts over.
        if (!nextTrimmed) {
            setResults(null);
            setSelectedIndex(0);
        }
    }, []);

    // Opened with a query (journal://search?q=)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the field once when the search opens with a query
        if (isOpen && initialQuery) handleQueryChange(initialQuery);
    }, [isOpen, initialQuery, handleQueryChange]);

    // Focus input when modal opens
    useEffect(() => {
        if (!isOpen) return;

        let cancelled = false;
        // Small timeout to ensure render is complete
        const timer = setTimeout(() => {
            inputRef.current?.focus();
        }, 10);

        // Notes opened since the modal last opened.
        const openedIds = loadRecentNotes();
        (async () => {
            const [opened, modified, folders] = await Promise.all([
                getNotesByIds(openedIds.map((n) => n.docId)),
                getRecentlyModifiedNotes(RECENT_MODIFIED_SHOWN),
                getAllFolders(),
            ]);
            if (cancelled) return;
            setRecentNotes(openedIds);
            setRecentSearches(loadRecentSearches());
            setOpenedNotes(opened);
            setModifiedNotes(modified);
            setFolderNames(new Map(folders.map((f) => [f.id, f.name])));
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

        // The empty state is already in state: clearing the input loads nothing.
        if (!trimmed) return;

        const debounce = setTimeout(async () => {
            // Use advanced search with FTS, fuzzy matching, and highlighting.
            // Untrimmed: a trailing space ends the last word, so it stops matching as a prefix.
            const searchResults = await advancedSearch(query);
            if (cancelled || requestSeqRef.current !== requestSeq) return;
            setPendingQuery((current) => (current === trimmed ? null : current));
            const next = applyRecentBoost(searchResults, loadRecentNotes().map((n) => n.docId));
            setResults(next);
            setSelectedIndex(Math.max(0, next.findIndex((r) => r.docId === selectedDocIdRef.current)));
        }, 150);

        return () => {
            cancelled = true;
            clearTimeout(debounce);
        };
    }, [query, isOpen]);

    const deferredResults = useDeferredValue(results ?? []);

    let entries: SearchEntry[];
    if (trimmedQuery) {
        entries = deferredResults.map((result) => ({ kind: 'note', section: 'notes', result }));
    } else {
        const recent = resolveRecentNotes(recentNotes, openedNotes);
        const recentIds = new Set(recent.map((r) => r.docId));
        entries = [
            ...recent.map((result): SearchEntry => ({ kind: 'note', section: 'recent', result })),
            ...recentSearches.map((text): SearchEntry => ({ kind: 'search', section: 'searches', text })),
            ...modifiedNotes
                .filter((r) => !recentIds.has(r.docId))
                .map((result): SearchEntry => ({ kind: 'note', section: 'notes', result })),
        ];
    }

    const selectedEntry = entries[selectedIndex];
    useEffect(() => {
        selectedDocIdRef.current = selectedEntry?.kind === 'note' ? selectedEntry.result.docId : undefined;
    }, [selectedEntry]);

    const handleSelectEntry = useCallback(
        (entry: SearchEntry) => {
            if (entry.kind === 'search') handleQueryChange(entry.text);
            else handleSelectResult(entry.result.docId, findTermForResult(entry.result, trimmedQuery));
        },
        [handleQueryChange, handleSelectResult, trimmedQuery]
    );

    const handleRemoveEntry = (entry: SearchEntry) => {
        if (entry.kind === 'search') {
            const next = removeRecentSearch(loadRecentSearches(), entry.text);
            saveRecentSearches(next);
            setRecentSearches(next);
        } else {
            const next = removeRecentNote(loadRecentNotes(), entry.result.docId);
            saveRecentNotes(next);
            setRecentNotes(next);
        }
    };

    const handleClearRecents = () => {
        saveRecentNotes([]);
        saveRecentSearches([]);
        setRecentNotes([]);
        setRecentSearches([]);
    };

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
        folderNames,
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
