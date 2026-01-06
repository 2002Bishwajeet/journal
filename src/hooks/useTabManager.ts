import { useState, useCallback, useEffect } from 'react';
import { saveAppState, getAppState } from '@/lib/db';

export interface TabInfo {
    docId: string;
    title: string;
    isDirty?: boolean;
}

interface TabManagerState {
    openTabs: TabInfo[];
    activeTabId: string | null;
}

const TABS_KEY = 'open_tabs';
const MAX_TABS = 10;

/**
 * Hook for managing open note tabs
 */
export function useTabManager() {
    const [state, setState] = useState<TabManagerState>({
        openTabs: [],
        activeTabId: null,
    });

    // Load saved tabs on mount
    useEffect(() => {
        const loadTabs = async () => {
            try {
                const saved = await getAppState<TabManagerState>(TABS_KEY);
                if (saved) {
                    setState(saved);
                }
            } catch (error) {
                console.error('Failed to load tabs:', error);
            }
        };

        loadTabs();
    }, []);

    // Save tabs whenever they change
    const saveTabs = useCallback(async (newState: TabManagerState) => {
        try {
            await saveAppState(TABS_KEY, newState);
        } catch (error) {
            console.error('Failed to save tabs:', error);
        }
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
    }, [saveTabs]);

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
    }, [saveTabs]);

    // Switch to a tab
    const switchTab = useCallback((docId: string) => {
        setState(prev => {
            if (!prev.openTabs.find(t => t.docId === docId)) return prev;
            const newState = { ...prev, activeTabId: docId };
            saveTabs(newState);
            return newState;
        });
    }, [saveTabs]);

    // Update tab title
    const updateTabTitle = useCallback((docId: string, title: string) => {
        setState(prev => {
            const newTabs = prev.openTabs.map(t =>
                t.docId === docId ? { ...t, title } : t
            );
            const newState = { ...prev, openTabs: newTabs };
            saveTabs(newState);
            return newState;
        });
    }, [saveTabs]);

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
    }, [saveTabs]);

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
    }, [saveTabs]);

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
