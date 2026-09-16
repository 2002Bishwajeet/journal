import { useState, useCallback, useEffect } from 'react';
import { getAppState } from '@/lib/db';
import { tryJsonParse } from '@/lib/utils';

export interface TabInfo {
    docId: string;
    title: string;
    isDirty?: boolean;
}

interface TabManagerState {
    openTabs: TabInfo[];
    activeTabId: string | null;
}

// Device-local UI state, so it lives in localStorage rather than PGlite: an
// app_state write costs a full IndexedDB flush, and it was queued ahead of the
// note's content read on every tab open.
export const TABS_STORAGE_KEY = 'journal-open-tabs';
const LEGACY_TABS_KEY = 'open_tabs'; // app_state row written before the move
const MAX_TABS = 10;

// tryJsonParse yields {} for unparseable data, and a legacy app_state row can
// hold anything — only trust a value that is actually a tab state.
function isTabState(value: unknown): value is TabManagerState {
    return Array.isArray((value as TabManagerState | null)?.openTabs);
}

function loadTabs(): TabManagerState | null {
    try {
        const raw = localStorage.getItem(TABS_STORAGE_KEY);
        if (!raw) return null;
        const parsed = tryJsonParse<TabManagerState>(raw);
        return isTabState(parsed) ? parsed : null;
    } catch {
        return null; // private browsing
    }
}

function saveTabs(state: TabManagerState): void {
    try {
        localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
        console.error('Failed to save tabs:', error);
    }
}

/**
 * Hook for managing open note tabs
 */
export function useTabManager() {
    const [state, setState] = useState<TabManagerState>(
        () => loadTabs() ?? { openTabs: [], activeTabId: null },
    );

    // One-time read of the pre-move app_state row, for tabs saved by an older
    // version. Nothing is written back — the next tab change persists locally.
    useEffect(() => {
        if (loadTabs()) return;

        const loadLegacyTabs = async () => {
            try {
                const saved = await getAppState<TabManagerState>(LEGACY_TABS_KEY);
                if (!isTabState(saved)) return;
                setState(prev => {
                    // This read waits on the whole database boot. A note opened
                    // from the URL in the meantime wins — adopting the legacy row
                    // here would switch the editor away from it.
                    if (prev.openTabs.length > 0) return prev;
                    saveTabs(saved);
                    return saved;
                });
            } catch (error) {
                console.error('Failed to load tabs:', error);
            }
        };

        loadLegacyTabs();
    }, []);

    // Open a new tab or switch to existing one
    const openTab = useCallback((docId: string, title: string) => {
        setState(prev => {
            const existingIndex = prev.openTabs.findIndex(t => t.docId === docId);

            if (existingIndex >= 0) {
                // Tab already open, just switch to it
                const newState = { ...prev, activeTabId: docId };
                saveTabs(newState);
                return newState;
            }

            // Add new tab
            const newTabs = [...prev.openTabs, { docId, title }];

            // Enforce max tabs limit
            if (newTabs.length > MAX_TABS) {
                // Remove the oldest tab (first one that isn't active)
                const removeIndex = newTabs.findIndex(t => t.docId !== prev.activeTabId);
                if (removeIndex >= 0) {
                    newTabs.splice(removeIndex, 1);
                }
            }

            const newState = {
                openTabs: newTabs,
                activeTabId: docId,
            };
            saveTabs(newState);
            return newState;
        });
    }, []);

    // Close a tab
    const closeTab = useCallback((docId: string) => {
        setState(prev => {
            const index = prev.openTabs.findIndex(t => t.docId === docId);
            if (index === -1) return prev;

            const newTabs = prev.openTabs.filter(t => t.docId !== docId);
            let newActiveId = prev.activeTabId;

            // If closing the active tab, switch to adjacent tab
            if (prev.activeTabId === docId) {
                if (newTabs.length === 0) {
                    newActiveId = null;
                } else if (index < newTabs.length) {
                    newActiveId = newTabs[index].docId;
                } else {
                    newActiveId = newTabs[newTabs.length - 1].docId;
                }
            }

            const newState = {
                openTabs: newTabs,
                activeTabId: newActiveId,
            };
            saveTabs(newState);
            return newState;
        });
    }, []);

    // Switch to a tab
    const switchTab = useCallback((docId: string) => {
        setState(prev => {
            if (!prev.openTabs.find(t => t.docId === docId)) return prev;
            const newState = { ...prev, activeTabId: docId };
            saveTabs(newState);
            return newState;
        });
    }, []);

    // Update tab title
    const updateTabTitle = useCallback((docId: string, title: string) => {
        setState(prev => {
            const tab = prev.openTabs.find(t => t.docId === docId);
            if (!tab || tab.title === title) return prev;
            const newTabs = prev.openTabs.map(t =>
                t.docId === docId ? { ...t, title } : t
            );
            const newState = { ...prev, openTabs: newTabs };
            saveTabs(newState);
            return newState;
        });
    }, []);

    // Mark tab as dirty (unsaved changes)
    const markTabDirty = useCallback((docId: string, isDirty: boolean) => {
        setState(prev => {
            const newTabs = prev.openTabs.map(t =>
                t.docId === docId ? { ...t, isDirty } : t
            );
            return { ...prev, openTabs: newTabs };
        });
    }, []);

    // Close all tabs
    const closeAllTabs = useCallback(() => {
        const newState = { openTabs: [], activeTabId: null };
        setState(newState);
        saveTabs(newState);
    }, []);

    // Close other tabs (keep only active)
    const closeOtherTabs = useCallback(() => {
        setState(prev => {
            const activeTab = prev.openTabs.find(t => t.docId === prev.activeTabId);
            const newState = {
                openTabs: activeTab ? [activeTab] : [],
                activeTabId: prev.activeTabId,
            };
            saveTabs(newState);
            return newState;
        });
    }, []);

    return {
        openTabs: state.openTabs,
        activeTabId: state.activeTabId,
        openTab,
        closeTab,
        switchTab,
        updateTabTitle,
        markTabDirty,
        closeAllTabs,
        closeOtherTabs,
    };
}
