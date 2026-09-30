import { useSyncExternalStore } from 'react';

function subscribe(onChange: () => void): () => void {
    window.addEventListener('scroll', onChange, { passive: true });
    return () => window.removeEventListener('scroll', onChange);
}

const getSnapshot = () => window.scrollY > 0;
const getServerSnapshot = () => false;

/** Whether the window has been scrolled away from the top. */
export function useHasScrolled(): boolean {
    return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
