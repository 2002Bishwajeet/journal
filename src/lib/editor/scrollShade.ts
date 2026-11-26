// A table wider than the note column scrolls inside its `.tableWrapper`. The
// scrollbar is an overlay on macOS and iOS, so nothing shows that more is hidden (#1389).
// This marks the wrapper with `data-shade-start` / `data-shade-end` for each edge that
// has hidden content; the `.prose .tableWrapper` rules in index.css fade those edges.
// It also marks `data-pin` when the first column should stay in view while the rest scrolls
// (#1390), for a table whose wrapper opted in with `data-pin-first` (#1528).

/** The wrapper attribute a table sets to opt in to a pinned first column. */
export const PIN_FIRST_ATTR = 'data-pin-first';

const EDGE = 1; // sub-pixel scroll positions must not count as hidden content

/** Which edges of a horizontal scroller have content hidden past them. */
export function hiddenEdges(scrollLeft: number, clientWidth: number, scrollWidth: number) {
    const left = Math.abs(scrollLeft);
    return { start: left > EDGE, end: scrollWidth - clientWidth - left > EDGE };
}

// A pinned column may take this share of the wrapper. A wider one is not pinned: it would
// leave no room to see what scrolls past it, and capping it would change a width the author
// set. `PIN_SLACK` keeps a column that sits on the limit from flipping as the border model changes.
const PIN_MAX_SHARE = 0.4;
const PIN_SLACK = 2;

/** Whether the first column stays pinned: the table overflows and that column leaves room to scroll. */
export function shouldPin(overflows: boolean, firstWidth: number, clientWidth: number, pinned: boolean) {
    return overflows && firstWidth <= clientWidth * PIN_MAX_SHARE + (pinned ? PIN_SLACK : 0);
}

/** Keeps the shade attributes of `el` current as it scrolls or resizes. Returns the cleanup. */
export function trackScrollShade(el: HTMLElement | null): (() => void) | void {
    if (!el) return;
    const update = () => {
        const { start, end } = hiddenEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
        el.toggleAttribute('data-shade-start', start);
        el.toggleAttribute('data-shade-end', end);
        const first = el.querySelector('tr > :is(th, td)');
        el.toggleAttribute('data-pin', !!first && el.hasAttribute(PIN_FIRST_ATTR) && shouldPin(start || end, first.getBoundingClientRect().width, el.clientWidth, el.hasAttribute('data-pin')));
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
