import { useContext } from 'react';
import { OnlineContext } from '@/contexts/OnlineContext';

/**
 * Hook to access the online status context.
 * Returns { isOnline: boolean }
 */
export const useOnlineContext = () => useContext(OnlineContext);
