import type { ImageEdits } from '@/lib/images/imageEdits';

/** One image of a gallery as the lightbox shows it (#1369). */
export interface LightboxItem {
    src: string;
    alt: string;
    edits?: ImageEdits;
}

/** The images of a gallery in order and which of them was opened. */
export interface LightboxGallery {
    items: LightboxItem[];
    index: number;
}

/** A horizontal touch swipe steps once it has gone this far (px). */
export const SWIPE_STEP_DISTANCE = 50;

/** The index `dir` away from `index`; it stops at the ends rather than wrapping. */
export function stepIndex(index: number, count: number, dir: -1 | 1): number {
    return Math.min(Math.max(index + dir, 0), count - 1);
}

/** Which way a finger drag of (`dx`, `dy`) steps: left to the next image, right to the previous, 0 for neither. */
export function swipeStep(dx: number, dy: number): -1 | 0 | 1 {
    if (Math.abs(dx) < SWIPE_STEP_DISTANCE || Math.abs(dx) <= Math.abs(dy)) return 0;
    return dx < 0 ? 1 : -1;
}
