import { useOnlineContext } from '@/hooks/useOnlineContext';

/**
 * Hook to get the current network status.
 * Returns true if the browser is online, false otherwise.
 */
export function useOnlineStatus() {
    const { isOnline } = useOnlineContext();
    return isOnline;
}
