import { useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getAppState } from '@/lib/db';
import { SESSION_STORAGE_KEY, readJson, writeJson } from '@/lib/storage';

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

const LEGACY_SESSION_KEY = 'session_state'; // app_state row written before the move
const SAVE_DEBOUNCE_MS = 500;

function loadSession(): SessionState | null {
    // Unparseable data reads back as {}, which the spread absorbs.
    const parsed = readJson<SessionState>(SESSION_STORAGE_KEY);
    return parsed ? { ...DEFAULT_SESSION_STATE, ...parsed } : null;
}

function persistSession(state: SessionState): void {
    writeJson(SESSION_STORAGE_KEY, state);
}

/**
 * Hook for persisting and restoring the last viewed note and scroll position
 */
export function useSessionPersistence() {
    const location = useLocation();
    const navigate = useNavigate();
    const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const sessionStateRef = useRef<SessionState>(DEFAULT_SESSION_STATE);
    const hasRestoredRef = useRef(false);
    const hasSavedRef = useRef(false);

    // Load session state on mount. The app_state row is only read for sessions
    // saved before the move to localStorage.
    useEffect(() => {
        const local = loadSession();
        if (local) {
            sessionStateRef.current = local;
            return;
        }

        const loadLegacySession = async () => {
            try {
                const saved = await getAppState<SessionState>(LEGACY_SESSION_KEY);
                // This read waits on the whole database boot. If navigation has
                // written the session in the meantime, adopting the legacy row
                // would make the next debounced save persist a stale note.
                if (!saved || hasSavedRef.current) return;
                sessionStateRef.current = { ...DEFAULT_SESSION_STATE, ...saved };
                persistSession(sessionStateRef.current);
            } catch (error) {
                console.error('Failed to load session state:', error);
            }
        };

        loadLegacySession();
    }, []);

    // Restore last viewed note on initial app load
    useEffect(() => {
        if (hasRestoredRef.current) return;
        if (location.pathname !== '/') return;

        const restoreSession = async () => {
            try {
                const saved = loadSession() ?? await getAppState<SessionState>(LEGACY_SESSION_KEY);
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
    const saveSession = useCallback((state: Partial<SessionState>) => {
        sessionStateRef.current = { ...sessionStateRef.current, ...state };
        hasSavedRef.current = true;

        // Debounce the save
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(() => {
            persistSession(sessionStateRef.current);
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
