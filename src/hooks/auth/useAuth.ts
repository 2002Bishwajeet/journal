import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { DotYouClient, ApiType } from '@homebase-id/js-lib/core';
import { base64ToUint8Array } from '@homebase-id/js-lib/helpers';
import {
    logout as homebaseLogout,
    retrieveIdentity,
} from '@homebase-id/js-lib/auth';
import {
    STORAGE_KEY_AUTH_TOKEN,
    STORAGE_KEY_SHARED_SECRET,
} from '@/lib/homebase/config';
import { useVerifyToken } from './useVerifyToken';
import { useOnlineContext } from '../useOnlineContext';


export type AuthenticationState = 'unknown' | 'anonymous' | 'authenticated';

const hasSharedSecret = () => {
    return !!localStorage.getItem(STORAGE_KEY_SHARED_SECRET);
};

/**
 * Core authentication hook.
 * Manages auth state, token validation, and provides auth utilities.
 */
export function useAuth() {
    const [authenticationState, setAuthenticationState] = useState<AuthenticationState>(
        hasSharedSecret() ? 'unknown' : 'anonymous'
    );
    const navigate = useNavigate();
    const { isOnline } = useOnlineContext();

    const getAppAuthToken = useCallback(() => {
        return localStorage.getItem(STORAGE_KEY_AUTH_TOKEN);
    }, []);

    const getSharedSecret = useCallback(() => {
        const raw = localStorage.getItem(STORAGE_KEY_SHARED_SECRET);
        if (raw) return base64ToUint8Array(raw);
        return undefined;
    }, []);

    const getIdentity = useCallback(() => {
        return retrieveIdentity();
    }, []);

    /**
     * Get a configured DotYouClient for authenticated API calls.
     * Returns null if not authenticated.
     */
    const getDotYouClient = useCallback((): DotYouClient | null => {
        const identity = getIdentity();
        if (!identity) return null;

        const headers: Record<string, string> = {};
        const authToken = getAppAuthToken();
        if (authToken) {
            headers['bx0900'] = authToken;
        }

        return new DotYouClient({
            sharedSecret: getSharedSecret(),
            api: ApiType.App,
            hostIdentity: identity,
            headers,
        });
    }, [getAppAuthToken, getSharedSecret, getIdentity]);

    // Memoize the client instance to avoid recreating it on every render
    // This ensures useQuery (in useVerifyToken) has stable dependencies
    const dotYouClient = useMemo(() => {
        return getDotYouClient();
    }, [getDotYouClient]);

    // Verify token in background
    const { data: hasValidToken, isFetchedAfterMount } = useVerifyToken(dotYouClient);

    /**
     * Log out: clear tokens and navigate to welcome page.
     */
    const logout = useCallback(async (): Promise<void> => {
        const client = getDotYouClient();
        if (client) {
            try {
                await homebaseLogout(client);
            } catch {
                // Ignore errors during logout
            }
        }

        localStorage.removeItem(STORAGE_KEY_SHARED_SECRET);
        localStorage.removeItem(STORAGE_KEY_AUTH_TOKEN);
        localStorage.removeItem('identity');

        navigate('/welcome');
        window.location.reload();
    }, [getDotYouClient, navigate]);

    // Handle auth state transitions
    useEffect(() => {
        // If we can't create a client, we're definitely not authenticated
        if (!dotYouClient) {
            return;
        }

        // If query hasn't run yet, wait
        if (!isFetchedAfterMount) {
            return;
        }

        // Query has completed, update state based on result
        if (hasValidToken === true) {
            queueMicrotask(() => {
                setAuthenticationState((prev) => (prev === 'authenticated' ? prev : 'authenticated'));
            });
            return;
        }

        if (hasValidToken === false) {
            queueMicrotask(() => {
                setAuthenticationState((prev) => (prev === 'anonymous' ? prev : 'anonymous'));
            });

            // If we had credentials but token is invalid, log out
            // BUT only if we are online. If offline, we might just be unable to verify.
            // Actually, useVerifyToken now returns true if offline, so this blok might not be reached if offline.
            // However, as a safety net:
            if (hasSharedSecret() && isOnline) {
                logout();
            }
        }
    }, [dotYouClient, hasValidToken, isFetchedAfterMount, logout, isOnline]);

    // Keep auth state aligned when we are definitely not authenticated
    useEffect(() => {
        if (dotYouClient) return;
        queueMicrotask(() => {
            setAuthenticationState((prev) => (prev === 'anonymous' ? prev : 'anonymous'));
        });
    }, [dotYouClient]);

    return {
        authenticationState,
        isAuthenticated: authenticationState === 'authenticated',
        logout,
        getDotYouClient,
        getSharedSecret,
        getIdentity,
    };
}

export default useAuth;
