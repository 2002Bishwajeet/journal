/** Zoom/pan maths for the lightbox. The view is `translate(x, y) scale(scale)` about the stage centre. */

export interface ZoomPan {
    scale: number;
    x: number;
    y: number;
}

export const MIN_SCALE = 1;
export const MAX_SCALE = 8;
export const FIT: ZoomPan = { scale: MIN_SCALE, x: 0, y: 0 };

const clampScale = (s: number) => Math.min(Math.max(s, MIN_SCALE), MAX_SCALE);

/** Scale by `factor`, keeping the content under (px, py) (relative to the stage centre) fixed. */
export function zoomAt(view: ZoomPan, factor: number, px: number, py: number): ZoomPan {
    const scale = clampScale(view.scale * factor);
    if (scale === MIN_SCALE) return FIT;
    const k = scale / view.scale;
    return { scale, x: px - (px - view.x) * k, y: py - (py - view.y) * k };
}

/** Double-click: back to fit if zoomed, else to the image's natural size (at least 2x so it always changes). */
export function toggleZoom(view: ZoomPan, naturalScale: number, px: number, py: number): ZoomPan {
    if (view.scale > MIN_SCALE) return FIT;
    return zoomAt(view, Math.max(naturalScale, 2), px, py);
}

/** A vertical drag at fit closes the viewer past this distance (px)... */
export const SWIPE_CLOSE_DISTANCE = 120;
/** ...or on a flick faster than this (px/ms) that has gone at least SWIPE_FLICK_MIN px. */
export const SWIPE_CLOSE_VELOCITY = 0.5;
export const SWIPE_FLICK_MIN = 24;

/** Whether releasing a swipe at `distance` px (either way) moving `velocity` px/ms closes the viewer. */
export function swipeCloses(distance: number, velocity: number): boolean {
    const d = Math.abs(distance);
    return d >= SWIPE_CLOSE_DISTANCE || (d >= SWIPE_FLICK_MIN && Math.abs(velocity) >= SWIPE_CLOSE_VELOCITY);
}
