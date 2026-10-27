import { useEffect, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { getAppState, getSearchIndexEntry } from '@/lib/db';
import { e2eSwitches } from '@/lib/e2e/switches';
import { SESSION_STORAGE_KEY, readJson, writeJson } from '@/lib/storage';

interface SessionState {
    lastNoteId: string | null;
    lastFolderId: string | null;
}

const DEFAULT_SESSION_STATE: SessionState = {
    lastNoteId: null,
    lastFolderId: null,
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
 * Hook for persisting and restoring the last viewed note
 */
export function useSessionPersistence(): void {
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
        if (location.pathname !== '/') {
            // The user navigated before the restore applied; theirs wins.
            hasRestoredRef.current = true;
            return;
        }
        // A query string means the URL already carries intent (a PWA shortcut,
        // a tag filter, a permission redirect) — restoring the last note would
        // race with (and override) whatever is handling it.
        if (location.search) {
            hasRestoredRef.current = true;
            return;
        }

        // Set by the cleanup when the user navigates while a read is pending.
        let cancelled = false;
        const restoreSession = async () => {
            try {
                const saved = loadSession() ?? await getAppState<SessionState>(LEGACY_SESSION_KEY);
                if (cancelled) return;
                if (saved?.lastNoteId && saved?.lastFolderId) {
                    // The note may have been archived, trashed or deleted since —
                    // land on its folder instead of "Note not found".
                    const entry = await getSearchIndexEntry(saved.lastNoteId);
                    if (e2eSwitches.sessionRestoreDelayMs) {
                        await new Promise((r) => setTimeout(r, e2eSwitches.sessionRestoreDelayMs));
                    }
                    if (cancelled) return;
                    const isActive = !!entry && !entry.metadata.archivalStatus;
                    navigate(
                        isActive ? `/${saved.lastFolderId}/${saved.lastNoteId}` : `/${saved.lastFolderId}`,
                        { replace: true },
                    );
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
        return () => {
            cancelled = true;
            clearTimeout(timeout);
        };
    }, [location.pathname, location.search, navigate]);

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
}
