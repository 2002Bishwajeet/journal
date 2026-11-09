import { useEffect, type RefObject } from 'react';

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
