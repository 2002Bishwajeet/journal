import { useSyncExternalStore } from 'react';

const QUERY = '(pointer: coarse)';

function subscribe(onChange: () => void) {
    const mql = window.matchMedia(QUERY);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
}

/** True when the primary input is a finger: long-press menus become action sheets (#784). */
export function useCoarsePointer(): boolean {
    return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
