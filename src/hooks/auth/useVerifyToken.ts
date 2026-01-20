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
                return await hasValidToken(dotYouClient);
            } catch (error) {
                console.error('[useVerifyToken] Error:', error);
                // If error is network related, maybe we should also return true?
                // But isOnline should handle most cases.
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
