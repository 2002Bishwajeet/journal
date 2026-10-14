import { useEffect, useState, type RefObject } from 'react';

export interface OutlineHeading {
    id: string;
    text: string;
    /** 2-4 */
    level: number;
}

/** The outline shows only for a note with at least this many headings. */
export const MIN_OUTLINE_HEADINGS = 3;

const HIDDEN_KEY = 'share.outlineHidden';
/** A heading above this many px from the viewport top counts as passed (the sticky header is 56px). */
const READING_LINE = 96;

function readHidden(): boolean {
    try {
        return localStorage.getItem(HIDDEN_KEY) === '1';
    } catch {
        return false;
    }
}

/** Scrolls to a heading, jumping instead of animating under `prefers-reduced-motion`. */
export function scrollToHeading(id: string): void {
    const el = document.getElementById(id);
    if (!el) return;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    history.replaceState(null, '', `#${id}`);
}

/**
 * The h2-h4 headings of the rendered article, the one being read (scroll-spy), and whether
 * the reader hid the panel (#643). `contentKey` re-reads the headings when the markdown changes.
 */
export function useShareOutline(articleRef: RefObject<HTMLElement | null>, contentKey: string) {
    const [headings, setHeadings] = useState<OutlineHeading[]>([]);
    const [activeId, setActiveId] = useState<string>();
    const [hidden, setHidden] = useState(readHidden);

    useEffect(() => {
        const article = articleRef.current;
        if (!article) return;
        const els = [...article.querySelectorAll<HTMLElement>('h2[id], h3[id], h4[id]')].filter((el) => !el.classList.contains('sr-only'));
        setHeadings(els.map((el) => ({ id: el.id, text: el.textContent?.trim() ?? '', level: Number(el.tagName[1]) })));

        let hash = '';
        try {
            hash = decodeURIComponent(window.location.hash.slice(1));
        } catch {
            // a malformed hash is no link
        }
        if (hash) document.getElementById(hash)?.scrollIntoView({ block: 'start' });

        if (els.length < MIN_OUTLINE_HEADINGS) return;
        const update = () => {
            // In the last screen the line slides down to the viewport bottom, so short last
            // sections that can never reach READING_LINE still get their turn.
            const left = document.documentElement.scrollHeight - window.scrollY - window.innerHeight;
            const line = Math.max(READING_LINE, window.innerHeight - left);
            const passed = els.filter((el) => el.getBoundingClientRect().top <= line);
            setActiveId((passed.at(-1) ?? els[0]).id);
        };
        update();
        // A thin band at the reading line: a heading crossing it re-runs the check.
        const bottom = Math.max(0, window.innerHeight - READING_LINE - 1);
        const observer = new IntersectionObserver(update, { rootMargin: `-${READING_LINE}px 0px -${bottom}px 0px` });
        els.forEach((el) => observer.observe(el));
        // Covers a jump that skips the band between frames.
        window.addEventListener('scroll', update, { passive: true });
        return () => {
            observer.disconnect();
            window.removeEventListener('scroll', update);
        };
    }, [articleRef, contentKey]);

    const toggleHidden = () => {
        const next = !hidden;
        setHidden(next);
        try {
            localStorage.setItem(HIDDEN_KEY, next ? '1' : '0');
        } catch {
            // private mode: the choice lasts until reload
        }
    };

    return { headings: headings.length >= MIN_OUTLINE_HEADINGS ? headings : [], activeId, hidden, toggleHidden };
}
