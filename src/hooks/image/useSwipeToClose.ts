import { useRef, type PointerEvent } from 'react';
import { animate, useReducedMotion, type MotionValue } from 'framer-motion';
import { swipeCloses } from '@/lib/images/zoomPan';

/** Movement before a touch counts as a swipe rather than a tap (px). */
const SLOP = 8;

/**
 * Swipe down (or up) to close the full-screen image viewer (#829), like iOS Photos. The
 * image follows the finger through `y`; letting go past the distance (or in a flick)
 * slides it off and closes, otherwise it springs back. Only at fit (`enabled`), where a
 * drag has nothing to pan. Touch only: a mouse drag stays a click.
 */
export function useSwipeToClose(y: MotionValue<number>, enabled: boolean, onClose: () => void) {
    const reduceMotion = useReducedMotion();
    const start = useRef<{ id: number; x: number; y: number } | null>(null);
    const swiping = useRef(false);
    const last = useRef({ y: 0, t: 0, velocity: 0 });

    const reset = () => {
        start.current = null;
        swiping.current = false;
    };

    const springBack = () => {
        if (reduceMotion) y.set(0);
        else animate(y, 0, { type: 'spring', stiffness: 500, damping: 40 });
    };

    return {
        onPointerDown: (e: PointerEvent<HTMLElement>) => {
            if (!enabled || e.pointerType !== 'touch') return;
            // A second finger is a pinch: give up the swipe
            if (start.current) {
                if (swiping.current) springBack();
                reset();
                return;
            }
            start.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
            last.current = { y: e.clientY, t: e.timeStamp, velocity: 0 };
        },
        onPointerMove: (e: PointerEvent<HTMLElement>) => {
            const s = start.current;
            if (!s || s.id !== e.pointerId) return;
            const dy = e.clientY - s.y;
            if (!swiping.current) {
                if (Math.abs(dy) < SLOP || Math.abs(dy) < Math.abs(e.clientX - s.x)) return;
                swiping.current = true;
            }
            const dt = e.timeStamp - last.current.t;
            if (dt > 0) last.current.velocity = (e.clientY - last.current.y) / dt;
            last.current.y = e.clientY;
            last.current.t = e.timeStamp;
            y.set(dy);
        },
        onPointerUp: (e: PointerEvent<HTMLElement>) => {
            const s = start.current;
            if (!s || s.id !== e.pointerId) return;
            const wasSwiping = swiping.current;
            reset();
            if (!wasSwiping) return;
            // A pause before letting go cancels the speed of the move before it
            const velocity = e.timeStamp - last.current.t > 100 ? 0 : last.current.velocity;
            const distance = y.get();
            if (!swipeCloses(distance, velocity)) return springBack();
            const away = Math.sign(distance || 1) * window.innerHeight;
            if (reduceMotion) onClose();
            else animate(y, away, { duration: 0.2, ease: 'easeOut', onComplete: onClose });
        },
        onPointerCancel: (e: PointerEvent<HTMLElement>) => {
            if (start.current?.id !== e.pointerId) return;
            if (swiping.current) springBack();
            reset();
        },
    };
}
