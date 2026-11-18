// A table wider than the note column scrolls inside its `.tableWrapper`. The
// scrollbar is an overlay on macOS and iOS, so nothing shows that more is hidden (#1389).
// This marks the wrapper with `data-shade-start` / `data-shade-end` for each edge that
// has hidden content; the `.prose .tableWrapper` rules in index.css fade those edges.

const EDGE = 1; // sub-pixel scroll positions must not count as hidden content

/** Which edges of a horizontal scroller have content hidden past them. */
export function hiddenEdges(scrollLeft: number, clientWidth: number, scrollWidth: number) {
    const left = Math.abs(scrollLeft);
    return { start: left > EDGE, end: scrollWidth - clientWidth - left > EDGE };
}

/** Keeps the shade attributes of `el` current as it scrolls or resizes. Returns the cleanup. */
export function trackScrollShade(el: HTMLElement | null): (() => void) | void {
    if (!el) return;
    const update = () => {
        const { start, end } = hiddenEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
        el.toggleAttribute('data-shade-start', start);
        el.toggleAttribute('data-shade-end', end);
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    // The wrapper changes size with the window; the table changes size as its cells are edited.
    const observer = new ResizeObserver(update);
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => {
        el.removeEventListener('scroll', update);
        observer.disconnect();
    };
}
