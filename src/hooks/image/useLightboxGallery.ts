import { useEffect, useState } from 'react';
import { stepIndex, type LightboxGallery, type LightboxItem } from '@/lib/images/lightboxGallery';

/**
 * Which image of a gallery the lightbox shows (#1369). Every opening starts at the image that
 * was opened; ArrowLeft and ArrowRight step while open. `single` is the opened image, shown
 * alone when there is no gallery.
 */
export function useLightboxGallery(open: boolean, gallery: LightboxGallery | undefined, single: LightboxItem) {
    const items = gallery?.items ?? [single];
    const count = items.length;
    const start = gallery?.index ?? 0;
    const [index, setIndex] = useState(start);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) setIndex(start);
    }
    const at = Math.min(index, count - 1);
    const step = (dir: -1 | 1) => setIndex(stepIndex(at, count, dir));

    useEffect(() => {
        if (!open || count < 2) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
            if (e.key === 'ArrowLeft') setIndex((i) => stepIndex(i, count, -1));
            else if (e.key === 'ArrowRight') setIndex((i) => stepIndex(i, count, 1));
        };
        document.addEventListener('keydown', onKeyDown);
        return () => document.removeEventListener('keydown', onKeyDown);
    }, [open, count]);

    const neighbours = [items[at - 1], items[at + 1]].filter(Boolean);
    return { items, count, index: at, current: items[at], neighbours, step, atStart: at === 0, atEnd: at === count - 1 };
}
