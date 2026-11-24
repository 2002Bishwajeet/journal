import { useEffect, useState, type RefObject } from 'react';
import { flushSync } from 'react-dom';

// A Map, not a WeakMap, so revealIntersections can walk it; the effect cleanup removes each entry.
const listenerCallbacks = new Map<Element, () => void>();
const cleanupSettings = new WeakMap<Element, boolean>();

let observer: IntersectionObserver;

const handleIntersections: IntersectionObserverCallback = (entries) => {
    entries.forEach((entry) => {
        if (listenerCallbacks.has(entry.target)) {
            const callback = listenerCallbacks.get(entry.target);
            const cleanup = cleanupSettings.get(entry.target);

            if (entry.isIntersecting || entry.intersectionRatio > 0) {
                if (cleanup) {
                    observer.unobserve(entry.target);
                    listenerCallbacks.delete(entry.target);
                }
                callback?.();
            }
        }
    });
};

const getIntersectionObserver = () => {
    if (observer === undefined) {
        observer = new IntersectionObserver(handleIntersections, {
            threshold: 0.15,
        });
    }
    return observer;
};

/** Runs the callback of every observed element inside `root` as if it had come into view (PDF export, #520). */
export function revealIntersections(root: Element): void {
    for (const [target, callback] of listenerCallbacks) {
        if (!root.contains(target)) continue;
        if (cleanupSettings.get(target)) {
            observer.unobserve(target);
            listenerCallbacks.delete(target);
        }
        callback();
    }
}

export const useIntersection = (
    elem: RefObject<HTMLElement | null> | undefined,
    callback: () => void,
    keepObserving = false
) => {
    useEffect(() => {
        const target = elem?.current;
        const obs = getIntersectionObserver();

        if (!target) return;

        listenerCallbacks.set(target, callback);
        cleanupSettings.set(target, !keepObserving);
        obs.observe(target);

        return () => {
            listenerCallbacks.delete(target);
            obs.unobserve(target);
        };
    }, [elem, callback, keepObserving]);
};

/**
 * Whether `elem` is near the view, both ways: false once it is further than a view's height
 * away (the note scroller's, else the window's) or hidden (a hidden desktop tab), true again
 * when it comes back (#1487). True until the first report, and from a print on
 * (revealIntersections), at once, so printElement finds what it shows.
 */
export function useInView(elem: RefObject<HTMLElement | null>): boolean {
    const [inView, setInView] = useState(true);
    useEffect(() => {
        const target = elem.current;
        if (!target) return;
        // The note scroller as root: rootMargin grows only the root, and an implicit viewport
        // root is still clipped by the scroller, so the margin would never reach past its edge.
        const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), {
            root: target.closest('[data-note-scroller]'),
            rootMargin: '100% 0px',
        });
        observer.observe(target);
        listenerCallbacks.set(target, () => flushSync(() => setInView(true)));
        cleanupSettings.set(target, false);
        return () => {
            observer.disconnect();
            listenerCallbacks.delete(target);
        };
    }, [elem]);
    return inView;
}
