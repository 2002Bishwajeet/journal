import { useEffect, useState, useCallback, useRef, useDeferredValue } from "react";
import { advancedSearch, getAllFolders, getNotesByIds, getRecentlyModifiedNotes, getTagCounts } from "@/lib/db";
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
import { IS_VALUES, parseSearchQuery, toSearchFilters, tokenAtCaret, type SearchToken } from "@/lib/search/searchPlan";

// Type for results - either basic search index entry or advanced result with highlights
export type SearchResult = SearchIndexEntry | NoteListEntry | AdvancedSearchResult;

export function isAdvancedResult(result: SearchResult): result is AdvancedSearchResult {
    return 'matchType' in result;
}

/** A suggestion that completes the filter being typed (#1230). `token` replaces it in the query. */
export interface FilterEntry {
    kind: 'filter';
    section: 'filters';
    key: SearchToken['kind'];
    label: string;
    count?: number;
    token: string;
}

/** One row of the flat list the arrow keys walk, in display order. */
export type SearchEntry =
    | { kind: 'note'; section: 'recent' | 'notes'; result: SearchResult }
    | { kind: 'search'; section: 'searches'; text: string }
    | FilterEntry;

/** A filter in the query, shown as a removable chip under the input. */
export interface SearchChip {
    label: string;
    token: SearchToken;
}

/** The phone's row of filter buttons: the first three start a token, Pinned toggles `is:pinned`. */
export type FilterButton = 'folder' | 'tag' | 'date' | 'pinned';
const BUTTON_PREFIX = { folder: 'folder:', tag: 'tag:', date: 'after:' } as const;

const DATE_LABELS: Record<string, string> = { today: 'Today', yesterday: 'Yesterday', week: 'Last 7 days', month: 'Last 30 days' };
const SUGGESTIONS_SHOWN = 8;
const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const asToken = (key: string, value: string) => {
    const name = value.replaceAll('"', '');
    return `${key}:${/\s/.test(name) ? `"${name}"` : name}`;
};

type Typing = NonNullable<ReturnType<typeof tokenAtCaret>>;

function filterOptions(
    typing: Typing,
    tags: { tag: string; count: number }[],
    folderNames: Map<string, string>,
): { name: string; label: string; token: string; count?: number }[] {
    switch (typing.key) {
        case 'tag':
            return tags.map(({ tag, count }) => ({
                name: tag,
                label: `#${tag}`,
                count,
                token: typing.hash && /^[^\s"#]+$/.test(tag) ? `#${tag}` : asToken('tag', tag),
            }));
        case 'folder':
            return [
                ...[...folderNames.values()].map((name) => ({ name, label: name, token: asToken('folder', name) })),
                { name: 'shared', label: 'Shared with me', token: 'folder:shared' },
            ];
        case 'is':
            return IS_VALUES.map((name) => ({ name, label: capitalize(name), token: `is:${name}` }));
        case 'after':
            return Object.entries(DATE_LABELS).map(([name, label]) => ({ name, label, token: `after:${name}` }));
        default:
            return [];
    }
}

/** The tags, folders, flags or dates that complete the token at the caret; names that start with the typed text first. */
function filterSuggestions(
    typing: Typing,
    query: string,
    tags: { tag: string; count: number }[],
    folderNames: Map<string, string>,
): FilterEntry[] {
    const value = typing.value.toLowerCase();
    const typed = query.slice(typing.start, typing.end).toLowerCase();
    const startsWith = (name: string) => (name.toLowerCase().startsWith(value) ? 0 : 1);
    return filterOptions(typing, tags, folderNames)
        // A token typed in full needs no suggestion.
        .filter((option) => option.name.toLowerCase().includes(value) && option.token.toLowerCase() !== typed)
        .sort((a, b) => startsWith(a.name) - startsWith(b.name))
        .slice(0, SUGGESTIONS_SHOWN)
        .map(({ label, count, token }) => ({ kind: 'filter', section: 'filters', key: typing.key, label, count, token }));
}

function chipLabel(token: SearchToken, folderNames: Map<string, string>): string {
    const value = token.value.toLowerCase();
    if (token.kind === 'tag') return `#${token.value}`;
    if (token.kind === 'is') return capitalize(value);
    if (token.kind === 'folder') {
        if (value === 'shared') return 'Shared with me';
        const names = [...folderNames.values()].filter((name) => name.toLowerCase().includes(value));
        return names.length === 1 ? names[0] : token.value;
    }
    return token.kind === 'after' && DATE_LABELS[value] ? DATE_LABELS[value] : `${token.kind} ${token.value}`;
}

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
    /** The query without its filters: the text the notes match. */
    searchText: string;
    chips: SearchChip[];
    inputRef: React.RefObject<HTMLInputElement | null>;
    /** What a screen reader hears once the query settles: the result count, "No results", or nothing. Not the visible empty-state text, so it is not on screen twice. */
    status: string;

    // Handlers
    /** Keeps Tab and Shift+Tab inside the dialog. */
    handleDialogKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
    /** `caret`: where the caret is after the change; the end when not given. */
    handleQueryChange: (value: string, caret?: number) => void;
    handleCaretChange: (caret: number) => void;
    handleRemoveChip: (chip: SearchChip) => void;
    handleFilterButton: (button: FilterButton) => void;
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
    const [tags, setTags] = useState<{ tag: string; count: number }[]>([]);
    const [caret, setCaret] = useState(0);
    const selectedDocIdRef = useRef<string | undefined>(undefined);
    // Filter suggestions above the notes, so a note's row index is its result index plus this.
    const suggestionCountRef = useRef(0);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [pendingQuery, setPendingQuery] = useState<string | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const [recentNotes, setRecentNotes] = useState(loadRecentNotes);
    const [recentSearches, setRecentSearches] = useState(loadRecentSearches);
    const requestSeqRef = useRef(0);
    // Set when a note is picked: focus then goes to the editor, not back to the opener.
    const pickedNoteRef = useRef(false);

    const trimmedQuery = query.trim();
    const isLoading = Boolean(
        pendingQuery && pendingQuery === trimmedQuery && trimmedQuery
    );
    const parsed = parseSearchQuery(query);
    const typing = tokenAtCaret(query, caret);
    const suggestions = typing ? filterSuggestions(typing, query, tags, folderNames) : [];
    const chips = parsed.tokens
        // The token being completed is not a chip yet.
        .filter((token) => !(suggestions.length > 0 && token.start === typing?.start))
        .map((token): SearchChip => ({ token, label: chipLabel(token, folderNames) }));

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
            pickedNoteRef.current = true;
            onSelectNote(docId, find);
            handleClose();
        },
        [onSelectNote, handleClose, trimmedQuery]
    );

    const handleQueryChange = useCallback((value: string, at = value.length) => {
        const nextTrimmed = value.trim();
        setPendingQuery(nextTrimmed ? nextTrimmed : null);
        setQuery(value);
        setCaret(at);
        // A query keeps the selection on its note while results change (see below); clearing starts over,
        // and so does typing a filter, whose suggestions come first.
        if (!nextTrimmed || tokenAtCaret(value, at)) setSelectedIndex(0);
        if (!nextTrimmed) setResults(null);
    }, []);

    // Opened with a query (journal://search?q=)
    useEffect(() => {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- seeds the field once when the search opens with a query
        if (isOpen && initialQuery) handleQueryChange(initialQuery);
    }, [isOpen, initialQuery, handleQueryChange]);

    // While open, the rest of the page is inert (the dialog is portalled to body, so it is a sibling);
    // on close, focus returns to whatever had it when search opened, or to the editor after a pick.
    useEffect(() => {
        if (!isOpen) return;
        const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        pickedNoteRef.current = false;
        const root = document.querySelector('[data-search-root]');
        const inerted = [...document.body.children].filter(
            (el): el is HTMLElement => el instanceof HTMLElement && el !== root && !el.hasAttribute('inert')
        );
        inerted.forEach((el) => el.setAttribute('inert', ''));
        return () => {
            inerted.forEach((el) => el.removeAttribute('inert'));
            if (!pickedNoteRef.current) {
                opener?.focus();
                return;
            }
            // The picked note's editor mounts after the route changes; wait a few frames for it.
            let frames = 0;
            const focusEditor = () => {
                const editor = [...document.querySelectorAll<HTMLElement>('textarea[placeholder="Untitled"]')].find((el) => el.offsetParent !== null);
                if (editor) editor.focus();
                else if (++frames < 30) requestAnimationFrame(focusEditor);
                else opener?.focus();
            };
            focusEditor();
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

        // Notes opened since the modal last opened.
        const openedIds = loadRecentNotes();
        (async () => {
            const [opened, modified, folders, tagCounts] = await Promise.all([
                getNotesByIds(openedIds.map((n) => n.docId)),
                getRecentlyModifiedNotes(RECENT_MODIFIED_SHOWN),
                getAllFolders(),
                getTagCounts(),
            ]);
            if (cancelled) return;
            setRecentNotes(openedIds);
            setRecentSearches(loadRecentSearches());
            setOpenedNotes(opened);
            setModifiedNotes(modified);
            setFolderNames(new Map(folders.map((f) => [f.id, f.name])));
            setTags(tagCounts);
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
            const { text, tokens } = parseSearchQuery(query);
            const filters = tokens.length ? toSearchFilters(tokens, folderNames) : undefined;
            const searchResults = await advancedSearch(text, { filters });
            if (cancelled || requestSeqRef.current !== requestSeq) return;
            setPendingQuery((current) => (current === trimmed ? null : current));
            const next = applyRecentBoost(searchResults, loadRecentNotes().map((n) => n.docId));
            setResults(next);
            const at = next.findIndex((r) => r.docId === selectedDocIdRef.current);
            setSelectedIndex(at === -1 ? 0 : at + suggestionCountRef.current);
        }, 150);

        return () => {
            cancelled = true;
            clearTimeout(debounce);
        };
        // folderNames: a `folder:` filter resolves to ids once the folders load.
    }, [query, isOpen, folderNames]);

    const deferredResults = useDeferredValue(results ?? []);

    let entries: SearchEntry[];
    if (trimmedQuery) {
        entries = [
            ...suggestions,
            ...deferredResults.map((result): SearchEntry => ({ kind: 'note', section: 'notes', result })),
        ];
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

    // Filter suggestions are not results.
    const noteCount = entries.length - suggestions.length;
    const status = !trimmedQuery || isLoading
        ? ''
        : noteCount === 0
            ? 'No results'
            : `${noteCount} ${noteCount === 1 ? 'result' : 'results'}`;

    const handleDialogKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
        if (e.key !== 'Tab') return;
        const focusable = [...e.currentTarget.querySelectorAll<HTMLElement>('input, button')].filter((el) => !el.hasAttribute('disabled'));
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;
        const active = document.activeElement;
        if (e.shiftKey ? active === first : active === last) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
        }
    }, []);

    const selectedEntry = entries[selectedIndex];
    useEffect(() => {
        selectedDocIdRef.current = selectedEntry?.kind === 'note' ? selectedEntry.result.docId : undefined;
        suggestionCountRef.current = suggestions.length;
    }, [selectedEntry, suggestions.length]);

    /** Sets the query and puts the caret at `at` in the focused input. */
    const editQuery = (value: string, at = value.length) => {
        handleQueryChange(value, at);
        inputRef.current?.focus();
        // After React has written the new value, which moves the caret to the end.
        setTimeout(() => inputRef.current?.setSelectionRange(at, at), 0);
    };

    // The filter suggestion's token replaces the one being typed, and a space ends it.
    const completeFilter = (token: string) => {
        if (!typing) return;
        const rest = query.slice(typing.end).trimStart();
        editQuery(`${query.slice(0, typing.start)}${token} ${rest}`, typing.start + token.length + 1);
    };

    const removeToken = ({ start, end }: SearchToken) => {
        const left = query.slice(0, start).trimEnd();
        const right = query.slice(end).trimStart();
        editQuery(left && right ? `${left} ${right}` : left + right);
    };

    const handleRemoveChip = (chip: SearchChip) => removeToken(chip.token);

    const handleFilterButton = (button: FilterButton) => {
        const pinned = parsed.tokens.find((token) => token.kind === 'is' && token.value === 'pinned');
        if (button === 'pinned' && pinned) return removeToken(pinned);
        const base = query && !/\s$/.test(query) ? `${query} ` : query;
        editQuery(base + (button === 'pinned' ? 'is:pinned ' : BUTTON_PREFIX[button]));
    };

    const handleSelectEntry = (entry: SearchEntry) => {
        if (entry.kind === 'search') handleQueryChange(entry.text);
        else if (entry.kind === 'filter') completeFilter(entry.token);
        else handleSelectResult(entry.result.docId, findTermForResult(entry.result, parsed.text));
    };

    const handleRemoveEntry = (entry: SearchEntry) => {
        if (entry.kind === 'search') {
            const next = removeRecentSearch(loadRecentSearches(), entry.text);
            saveRecentSearches(next);
            setRecentSearches(next);
        } else if (entry.kind === 'note') {
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

    const handleKeyDown = (e: React.KeyboardEvent) => {
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
    };

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
        searchText: parsed.text,
        chips,
        inputRef,
        status,
        handleDialogKeyDown,
        handleQueryChange,
        handleCaretChange: setCaret,
        handleRemoveChip,
        handleFilterButton,
        handleKeyDown,
        handleClose,
        handleSelectResult,
        setSelectedIndex,
        handleSelectEntry,
        handleRemoveEntry,
        handleClearRecents,
    };
}
