import { useEffect, useEffectEvent, type RefObject } from 'react';
import type { Size } from '@/lib/images/imageEdits';

/**
 * Gives an image node that has no stored size (a note from before #1387) one, in a single
 * write: the size the note file's header lists for it, else the first image that loads in
 * `boxRef` (the aria-hidden tiny thumbnail doesn't count). Does nothing once the node has a
 * size, or when `enabled` is false (a view-only editor).
 */
export function useBackfillImageSize(
    boxRef: RefObject<HTMLElement | null>,
    { enabled, stored, fromHeader, write }: { enabled: boolean; stored?: Size; fromHeader?: Size; write: (size: Size) => void },
): void {
    const save = useEffectEvent(write);
    const storedKey = stored ? `${stored.width}x${stored.height}` : '';
    const headerKey = fromHeader ? `${fromHeader.width}x${fromHeader.height}` : '';

    useEffect(() => {
        const box = boxRef.current;
        if (!enabled || storedKey || !box) return;
        if (fromHeader) {
            save(fromHeader);
            return;
        }
        const measure = (img: HTMLImageElement) => {
            if (img.getAttribute('aria-hidden') === 'true') return;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) save({ width: img.naturalWidth, height: img.naturalHeight });
        };
        box.querySelectorAll('img').forEach((img) => img.complete && measure(img));
        // load doesn't bubble, but it does pass through the capture phase.
        const onLoad = (e: Event) => {
            if (e.target instanceof HTMLImageElement) measure(e.target);
        };
        box.addEventListener('load', onLoad, true);
        return () => box.removeEventListener('load', onLoad, true);
        // fromHeader is keyed by its numbers: the header query hands back a new object on a refetch
        // eslint-disable-next-line react-hooks/exhaustive-deps -- boxRef is a stable ref and fromHeader is covered by headerKey
    }, [enabled, storedKey, headerKey]);
}
