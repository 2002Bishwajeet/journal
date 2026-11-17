import { useRef, type PointerEvent } from 'react';
import { swipeStep } from '@/lib/images/lightboxGallery';

/**
 * Swipe sideways to step to the next or previous image of a gallery in the viewer (#1369).
 * Only at fit (`enabled`), where a drag has nothing to pan. Touch only: a mouse drag stays a
 * click. A vertical swipe is the viewer's swipe-to-close, so a mostly vertical drag steps nothing.
 */
export function useSwipeToStep(enabled: boolean, onStep: (dir: -1 | 1) => void) {
    const start = useRef<{ id: number; x: number; y: number } | null>(null);

    return {
        onPointerDown: (e: PointerEvent<HTMLElement>) => {
            if (!enabled || e.pointerType !== 'touch') return;
            // A second finger is a pinch: give up the swipe
            start.current = start.current ? null : { id: e.pointerId, x: e.clientX, y: e.clientY };
        },
        onPointerUp: (e: PointerEvent<HTMLElement>) => {
            const s = start.current;
            if (!s || s.id !== e.pointerId) return;
            start.current = null;
            const dir = swipeStep(e.clientX - s.x, e.clientY - s.y);
            if (dir) onStep(dir);
        },
        onPointerCancel: (e: PointerEvent<HTMLElement>) => {
            if (start.current?.id === e.pointerId) start.current = null;
        },
    };
}
