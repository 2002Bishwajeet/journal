import { useSyncExternalStore } from 'react';

// Phones, and touch tablets below the desktop breakpoint (the same widths useDeviceType calls
// mobile and tablet), get sheets; a mouse at any width keeps dialogs and popovers (#823).
const QUERY = '(max-width: 767px), (max-width: 1023px) and (pointer: coarse)';

function subscribe(onChange: () => void) {
    const mql = window.matchMedia(QUERY);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
}

/** True where a picker or form should be a sheet instead of a centred dialog. */
export function useSheetMode(): boolean {
    return useSyncExternalStore(subscribe, () => window.matchMedia(QUERY).matches, () => false);
}
