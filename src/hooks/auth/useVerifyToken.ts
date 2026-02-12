import { useQuery } from '@tanstack/react-query';
import { DotYouClient } from '@homebase-id/js-lib/core';
import { hasValidToken } from '@homebase-id/js-lib/auth';
import { useOnlineContext } from '../useOnlineContext';


/**
 * Hook to verify if the current auth token is still valid.
 * Uses TanStack Query for background validation.
 */
export function useVerifyToken(dotYouClient: DotYouClient | null) {
    const identity = dotYouClient?.getHostIdentity() || 'anonymous';
    const { isOnline } = useOnlineContext();

    return useQuery({
        queryKey: ['verifyToken', identity],
        queryFn: async () => {
            if (!dotYouClient) return false;
            // If offline, assume token is valid to prevent logout
            if (!isOnline) return true;
            try {
                // Race the token check against a timeout
                // If the server is slow or hanging (common with some network issues), assume valid/offline after 2s
                const timeoutPromise = new Promise<boolean>((resolve) =>
                    setTimeout(() => {
                        console.warn('[useVerifyToken] Token verification timed out, assuming offline/valid');
                        resolve(true);
                    }, 2000)
                );

                const checkPromise = hasValidToken(dotYouClient);

                return await Promise.race([checkPromise, timeoutPromise]);
            } catch (error) {
                console.error('[useVerifyToken] Error:', error);

                // Check if it's a network error (server offline/unreachable)
                // In these cases, we should be optimistic and allow the user to proceed
                if (error instanceof TypeError && (error.message === 'Failed to fetch' || error.message.includes('Network request failed'))) {
                    console.log('[useVerifyToken] Network error detected, assuming offline mode');
                    return true;
                }

                return false;
            }
        },
        enabled: !!dotYouClient,
        staleTime: Infinity, // Don't refetch automatically
        gcTime: 1000 * 60 * 5, // Keep in cache for 5 minutes
        refetchOnWindowFocus: false, // Don't refetch on window focus
        refetchOnMount: false, // Don't refetch on mount if we have data
        retry: false,
    });
}

export default useVerifyToken;
