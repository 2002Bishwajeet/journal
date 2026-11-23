import { useLayoutEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { navRendered } from '@/lib/navWatch';

/** Inside the router, outside its Suspense: a location renders only once the whole route can (#1467, navWatch.ts). */
export function useNavWatch(): void {
  const { key } = useLocation();
  useLayoutEffect(() => navRendered(key), [key]);
}
