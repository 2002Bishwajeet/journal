// @vitest-environment happy-dom
/**
 * A page iOS loads again after killing the web view's content process comes back on the
 * same URL; resumeRestore puts the note's scroll position back once the note has rendered, and
 * only then tells the native app (window.__JOURNAL_RESTORED__) to take its snapshot away (#1187).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { installResumeRestore, saveResumeState } from '@/lib/resumeRestore';
import { RESUME_STATE_KEY } from '@/lib/storage';

let frames: FrameRequestCallback[] = [];

function flushFrames(): void {
    const pending = frames;
    frames = [];
    pending.forEach((frame) => frame(0));
}

/** A note scroller with layout happy-dom doesn't compute. */
function addScroller(sizes: { clientHeight: number; scrollHeight: number; scrollTop?: number }): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-note-scroller', '');
    Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => sizes.clientHeight });
    Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => sizes.scrollHeight });
    el.scrollTop = sizes.scrollTop ?? 0;
    document.getElementById('root')!.appendChild(el);
    return el;
}

function saveState(path: string, scrollTop: number | null): void {
    localStorage.setItem(RESUME_STATE_KEY, JSON.stringify({ path, scrollTop }));
}

beforeEach(() => {
    document.body.innerHTML = '<div id="root"><div data-splash></div></div>';
    history.replaceState(null, '', '/folder-1/note-1');
    localStorage.clear();
    delete window.__JOURNAL_RESTORED__;
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((frame) => {
        frames.push(frame);
        return frames.length;
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe('saveResumeState', () => {
    it('saves the URL and the shown note scroller offset', () => {
        // A hidden desktop tab's note comes first and has no height.
        addScroller({ clientHeight: 0, scrollHeight: 0, scrollTop: 50 });
        addScroller({ clientHeight: 800, scrollHeight: 3000, scrollTop: 1200 });
        history.replaceState(null, '', '/folder-1/note-1?tag=x');
        saveResumeState();
        expect(JSON.parse(localStorage.getItem(RESUME_STATE_KEY)!)).toEqual({
            path: '/folder-1/note-1?tag=x',
            scrollTop: 1200,
        });
    });

    it('saves no offset when no note is open', () => {
        history.replaceState(null, '', '/folder-1');
        saveResumeState();
        expect(JSON.parse(localStorage.getItem(RESUME_STATE_KEY)!)).toEqual({ path: '/folder-1', scrollTop: null });
    });

    it('saves when the page is hidden', () => {
        installResumeRestore();
        addScroller({ clientHeight: 800, scrollHeight: 3000, scrollTop: 640 });
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        document.dispatchEvent(new Event('visibilitychange'));
        expect(JSON.parse(localStorage.getItem(RESUME_STATE_KEY)!).scrollTop).toBe(640);
    });
});

describe('installResumeRestore', () => {
    it('when the same URL loads again, scrolls the note back once it is tall enough, then marks the page restored', () => {
        saveState('/folder-1/note-1', 1200);
        installResumeRestore();
        flushFrames();
        expect(window.__JOURNAL_RESTORED__).toBeUndefined();

        // The splash is gone, but the note hasn't loaded its content yet.
        document.querySelector('[data-splash]')!.remove();
        const sizes = { clientHeight: 800, scrollHeight: 900 };
        const scroller = addScroller(sizes);
        flushFrames();
        expect(window.__JOURNAL_RESTORED__).toBeUndefined();
        expect(scroller.scrollTop).toBe(0);

        sizes.scrollHeight = 3000;
        flushFrames();
        expect(scroller.scrollTop).toBe(1200);
        expect(window.__JOURNAL_RESTORED__).toBe(true);
    });

    it('marks the page restored once the splash is gone when no note was open', () => {
        saveState('/folder-1/note-1', null);
        installResumeRestore();
        flushFrames();
        expect(window.__JOURNAL_RESTORED__).toBeUndefined();
        document.querySelector('[data-splash]')!.replaceWith(document.createElement('main'));
        flushFrames();
        expect(window.__JOURNAL_RESTORED__).toBe(true);
    });

    it.each([
        ['another note', '/folder-1/note-2'],
        ['the same note with a query string', '/folder-1/note-1?action=search'],
    ])('leaves the scroll alone when the saved URL is %s', (_, path) => {
        saveState(path, 1200);
        document.querySelector('[data-splash]')!.remove();
        const scroller = addScroller({ clientHeight: 800, scrollHeight: 3000 });
        installResumeRestore();
        expect(scroller.scrollTop).toBe(0);
        expect(window.__JOURNAL_RESTORED__).toBe(true);
    });

    it('gives up waiting after a while and scrolls as far as the note goes', () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        saveState('/folder-1/note-1', 5000);
        document.querySelector('[data-splash]')!.remove();
        const scroller = addScroller({ clientHeight: 800, scrollHeight: 3000 });
        installResumeRestore();
        flushFrames();
        expect(window.__JOURNAL_RESTORED__).toBeUndefined();

        vi.setSystemTime(Date.now() + 9000);
        flushFrames();
        expect(window.__JOURNAL_RESTORED__).toBe(true);
        // A browser clamps this to the most the note scrolls; happy-dom keeps the value.
        expect(scroller.scrollTop).toBe(5000);
    });

    it('on a launch, scrolls the note back once session restore has moved from / to it', () => {
        saveState('/folder-1/note-1', 1200);
        history.replaceState(null, '', '/');
        installResumeRestore();
        document.querySelector('[data-splash]')!.replaceWith(document.createElement('main'));
        flushFrames();
        expect(window.__JOURNAL_RESTORED__).toBeUndefined();

        history.replaceState(null, '', '/folder-1/note-1');
        const scroller = addScroller({ clientHeight: 800, scrollHeight: 3000 });
        flushFrames();
        expect(scroller.scrollTop).toBe(1200);
        expect(window.__JOURNAL_RESTORED__).toBe(true);
    });

    it('on a launch that session restore takes elsewhere, a later visit to the note keeps its scroll', () => {
        saveState('/folder-1/note-1', 1200);
        history.replaceState(null, '', '/');
        installResumeRestore();
        document.querySelector('[data-splash]')!.replaceWith(document.createElement('main'));
        history.replaceState(null, '', '/folder-1');
        flushFrames();
        expect(window.__JOURNAL_RESTORED__).toBe(true);

        history.replaceState(null, '', '/folder-1/note-1');
        const scroller = addScroller({ clientHeight: 800, scrollHeight: 3000 });
        flushFrames();
        expect(scroller.scrollTop).toBe(0);
    });
});

describe('discardResumeState', () => {
    it('deletes the state, and the page saves none after it (logout reloads the page)', async () => {
        vi.resetModules();
        const restore = await import('@/lib/resumeRestore');
        saveState('/folder-1/note-1', 1200);
        restore.discardResumeState();
        expect(localStorage.getItem(RESUME_STATE_KEY)).toBeNull();
        restore.saveResumeState();
        expect(localStorage.getItem(RESUME_STATE_KEY)).toBeNull();
    });
});
