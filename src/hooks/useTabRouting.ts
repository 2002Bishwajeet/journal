import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTabManager, staleTabIds, nextActiveTabId } from '@/hooks/useTabManager';
import { useMountedTabs } from '@/hooks/useMountedTabs';
import type { NoteListEntry } from '@/types';

interface UseTabRoutingOptions {
    noteId: string | undefined;
    folderId: string | undefined;
    notes: NoteListEntry[];
    isNotesLoading: boolean;
}

/**
 * Desktop tabs kept in sync with the URL: the note in the URL opens as a tab,
 * clicking a tab navigates to it, and closing the active tab navigates to the
 * tab that becomes active (or the folder).
 */
export function useTabRouting({ noteId, folderId, notes, isNotesLoading }: UseTabRoutingOptions) {
    const navigate = useNavigate();

    const {
        openTabs,
        activeTabId,
        openTab,
        closeTab,
        switchTab,
        updateTabTitle,
    } = useTabManager();

    // Desktop keep-alive: which tabs currently have a mounted editor.
    const mountedTabs = useMountedTabs(openTabs, activeTabId);

    const notesRef = useRef(notes);
    useEffect(() => {
        notesRef.current = notes;
    }, [notes]);

    // Open tab when noteId changes (URL navigation, back/forward)
    useEffect(() => {
        if (noteId) {
            const note = notesRef.current.find((n) => n.docId === noteId);
            openTab(noteId, note?.title || 'Untitled');
        }
    }, [noteId, openTab]);

    // Once, at boot: drop restored tabs whose note is gone (archived, trashed or
    // deleted on another device). One-shot on purpose — running on every notes
    // change would close a just-created note before the live query includes it.
    const hasPrunedTabsRef = useRef(false);
    useEffect(() => {
        if (isNotesLoading || hasPrunedTabsRef.current) return;
        hasPrunedTabsRef.current = true;
        const liveIds = new Set(notes.map((n) => n.docId));
        staleTabIds(openTabs, liveIds, noteId).forEach(closeTab);
    }, [isNotesLoading, notes, openTabs, noteId, closeTab]);

    // Sync tab titles when notes data changes
    useEffect(() => {
        if (activeTabId) {
            const note = notes.find((n) => n.docId === activeTabId);
            if (note) {
                updateTabTitle(activeTabId, note.title || 'Untitled');
            }
        }
    }, [notes, activeTabId, updateTabTitle]);

    // Handle tab click - navigate to the note
    const handleTabClick = (docId: string) => {
        const note = notes.find((n) => n.docId === docId);
        if (note) {
            navigate(`/${note.metadata.folderId}/${docId}`, { viewTransition: true });
            switchTab(docId);
        }
    };

    // Handle tab close
    // Reads notesRef rather than notes so handleArchive, which every memoized
    // NoteItem receives, doesn't change identity on each note edit.
    const handleTabClose = useCallback(
        (docId: string) => {
            // Same tab closeTab activates, so the URL effect doesn't mount another one.
            const nextId = nextActiveTabId(openTabs, docId, activeTabId);
            closeTab(docId);

            // If closing the active tab, navigate to the next tab's note or the folder
            if (docId === noteId) {
                const note = nextId
                    ? notesRef.current.find((n) => n.docId === nextId)
                    : undefined;
                if (note) {
                    navigate(`/${note.metadata.folderId}/${nextId}`, {
                        viewTransition: true,
                    });
                } else {
                    navigate(folderId ? `/${folderId}` : '/', { viewTransition: true });
                }
            }
        },
        [openTabs, activeTabId, closeTab, noteId, folderId, navigate],
    );

    return {
        openTabs,
        activeTabId,
        mountedTabs,
        closeTab,
        handleTabClick,
        handleTabClose,
    };
}
