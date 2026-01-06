import { useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { saveAppState, getAppState } from '@/lib/db';

interface SessionState {
    lastNoteId: string | null;
    lastFolderId: string | null;
    scrollPositions: Record<string, number>;
    sidebarCollapsed: boolean;
}

const DEFAULT_SESSION_STATE: SessionState = {
    lastNoteId: null,
    lastFolderId: null,
    scrollPositions: {},
    sidebarCollapsed: false,
};

const SESSION_KEY = 'session_state';
const SAVE_DEBOUNCE_MS = 500;

/**
 * Hook for persisting and restoring the last viewed note and scroll position
 */
export function useSessionPersistence() {
    const location = useLocation();
    const navigate = useNavigate();
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sessionStateRef = useRef<SessionState>(DEFAULT_SESSION_STATE);
    const hasRestoredRef = useRef(false);

    // Load session state on mount
    useEffect(() => {
        const loadSession = async () => {
            try {
                const saved = await getAppState<SessionState>(SESSION_KEY);
                if (saved) {
                    sessionStateRef.current = { ...DEFAULT_SESSION_STATE, ...saved };
                }
            } catch (error) {
                console.error('Failed to load session state:', error);
            }
        };

        loadSession();
    }, []);

    // Restore last viewed note on initial app load
    useEffect(() => {
        if (hasRestoredRef.current) return;
        if (location.pathname !== '/') return;

        const restoreSession = async () => {
            try {
                const saved = await getAppState<SessionState>(SESSION_KEY);
                if (saved?.lastNoteId && saved?.lastFolderId) {
                    navigate(`/${saved.lastFolderId}/${saved.lastNoteId}`, { replace: true });
                } else if (saved?.lastFolderId) {
                    navigate(`/${saved.lastFolderId}`, { replace: true });
                }
                hasRestoredRef.current = true;
            } catch (error) {
                console.error('Failed to restore session:', error);
                hasRestoredRef.current = true;
            }
        };

        // Small delay to let the app initialize
        const timeout = setTimeout(restoreSession, 100);
        return () => clearTimeout(timeout);
    }, [location.pathname, navigate]);

    // Save current location to session
    const saveSession = useCallback(async (state: Partial<SessionState>) => {
        sessionStateRef.current = { ...sessionStateRef.current, ...state };

        // Debounce the save
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(async () => {
            try {
                await saveAppState(SESSION_KEY, sessionStateRef.current);
            } catch (error) {
                console.error('Failed to save session state:', error);
            }
        }, SAVE_DEBOUNCE_MS);
    }, []);

    // Track the current note/folder
    useEffect(() => {
        const pathParts = location.pathname.split('/').filter(Boolean);
        const folderId = pathParts[0] || null;
        const noteId = pathParts[1] || null;

        if (folderId || noteId) {
            saveSession({
                lastFolderId: folderId,
                lastNoteId: noteId,
            });
        }
    }, [location.pathname, saveSession]);

    // Save scroll position for a specific note
    const saveScrollPosition = useCallback((noteId: string, scrollTop: number) => {
        saveSession({
            scrollPositions: {
                ...sessionStateRef.current.scrollPositions,
                [noteId]: scrollTop,
            },
        });
    }, [saveSession]);

    // Get saved scroll position for a note
    const getScrollPosition = useCallback((noteId: string): number => {
        return sessionStateRef.current.scrollPositions[noteId] || 0;
    }, []);

    // Save sidebar collapsed state
    const saveSidebarState = useCallback((collapsed: boolean) => {
        saveSession({ sidebarCollapsed: collapsed });
    }, [saveSession]);

    // Get sidebar collapsed state
    const getSidebarState = useCallback((): boolean => {
        return sessionStateRef.current.sidebarCollapsed;
    }, []);

    return {
        saveScrollPosition,
        getScrollPosition,
        saveSidebarState,
        getSidebarState,
    };
}
