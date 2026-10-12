import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react';
import { FIT, toggleZoom, zoomAt, type ZoomPan } from '@/lib/images/zoomPan';

/**
 * Wheel/pinch zoom, drag to pan and double-click fit/100% for the lightbox
 * stage. `stage` is the clipping element; the zoomed content lives inside it.
 * Pointer events cover mouse, pen and touch (one pointer pans, two pinch).
 */
export function useZoomPan(stage: HTMLElement | null) {
    const [view, setView] = useState<ZoomPan>(FIT);
    const pointers = useRef(new Map<number, { x: number; y: number }>());
    const pinchDistance = useRef(0);
    const moved = useRef(false);

    // Offset of a client point from the stage centre
    const rel = (clientX: number, clientY: number) => {
        const r = stage!.getBoundingClientRect();
        return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
    };

    // Native listener: React's onWheel is passive, so it can't stop the page from scrolling.
    useEffect(() => {
        if (!stage) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const r = stage.getBoundingClientRect();
            // Trackpad pinch arrives as ctrl+wheel with small deltas
            const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002));
            setView((v) => zoomAt(v, factor, e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2));
        };
        stage.addEventListener('wheel', onWheel, { passive: false });
        return () => stage.removeEventListener('wheel', onWheel);
    }, [stage]);

    const spread = () => {
        const [a, b] = [...pointers.current.values()];
        return Math.hypot(a.x - b.x, a.y - b.y);
    };

    const stageProps = {
        onPointerDown: (e: PointerEvent<HTMLElement>) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
            moved.current = false;
            if (pointers.current.size === 2) pinchDistance.current = spread();
        },
        onPointerMove: (e: PointerEvent<HTMLElement>) => {
            const prev = pointers.current.get(e.pointerId);
            if (!prev) return;
            const next = { x: e.clientX, y: e.clientY };
            pointers.current.set(e.pointerId, next);
            if (pointers.current.size === 2) {
                const d = spread();
                const [a, b] = [...pointers.current.values()];
                const c = rel((a.x + b.x) / 2, (a.y + b.y) / 2);
                const factor = d / (pinchDistance.current || d);
                pinchDistance.current = d;
                moved.current = true;
                setView((v) => zoomAt(v, factor, c.x, c.y));
            } else {
                const dx = next.x - prev.x;
                const dy = next.y - prev.y;
                if (dx || dy) moved.current = true;
                setView((v) => (v.scale > 1 ? { ...v, x: v.x + dx, y: v.y + dy } : v));
            }
        },
        onPointerUp: (e: PointerEvent<HTMLElement>) => {
            pointers.current.delete(e.pointerId);
        },
        onPointerCancel: (e: PointerEvent<HTMLElement>) => {
            pointers.current.delete(e.pointerId);
        },
        // detail 2 is the second click of a double-click (once per double-click, mouse or touch)
        onClick: (e: MouseEvent<HTMLElement>) => {
            if (e.detail !== 2) return;
            const p = rel(e.clientX, e.clientY);
            const img = stage?.querySelector('img');
            const natural = img && img.clientWidth ? img.naturalWidth / img.clientWidth : 1;
            setView(toggleZoom(view, natural, p.x, p.y));
        },
    };

    return { view, stageProps, wasDragged: () => moved.current };
}
