// @vitest-environment happy-dom
/**
 * Dialogs follow the iOS software keyboard (#783): while the visual viewport is
 * shorter than the window, the dialog gets the centre and height of what is left.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { followKeyboard, keepPageInPlace } from '@/lib/keyboardViewport';

class FakeViewport extends EventTarget {
    height = 852;
    offsetTop = 0;
    scale = 1;
    set(values: Partial<Pick<FakeViewport, 'height' | 'offsetTop' | 'scale'>>) {
        Object.assign(this, values);
        this.dispatchEvent(new Event('resize'));
    }
}

let vv: FakeViewport;
let el: HTMLElement;
const vars = () => [el.style.getPropertyValue('--dialog-top'), el.style.getPropertyValue('--dialog-max-h')];

beforeEach(() => {
    vv = new FakeViewport();
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 852, configurable: true });
    el = document.createElement('div');
});

describe('followKeyboard', () => {
    it('should set nothing while the whole window is visible', () => {
        followKeyboard(el);
        expect(vars()).toEqual(['', '']);
    });

    it('should centre in the visible part while the keyboard is up, and clear when it closes', () => {
        followKeyboard(el);
        vv.set({ height: 450, offsetTop: 120 });
        expect(vars()).toEqual(['345px', '450px']);
        vv.set({ height: 852, offsetTop: 0 });
        expect(vars()).toEqual(['', '']);
    });

    it('should not count the page scroll twice in the iOS app, where innerHeight shrinks by it', () => {
        Object.defineProperty(window, 'innerHeight', { value: 734, configurable: true });
        Object.defineProperty(document.documentElement, 'clientHeight', { value: 852, configurable: true });
        followKeyboard(el);
        vv.set({ height: 456, offsetTop: 118 });
        expect(vars()).toEqual(['228px', '456px']);
        delete (document.documentElement as { clientHeight?: number }).clientHeight;
    });

    it('should ignore a pinch zoom, which also shrinks the visual viewport', () => {
        followKeyboard(el);
        vv.set({ height: 426, scale: 2 });
        expect(vars()).toEqual(['', '']);
    });

    it('should stop following once cleaned up', () => {
        followKeyboard(el)!();
        vv.set({ height: 450 });
        expect(vars()).toEqual(['', '']);
    });
});

/**
 * The keyboard never scrolls a page that fits the window (#1300): iOS scrolls the whole page to
 * show a focused field, which takes the top bars with it. The field is scrolled into view in its
 * own container instead.
 */
describe('keepPageInPlace', () => {
    const root = document.documentElement;
    let frames: FrameRequestCallback[];
    let cleanup: () => void;
    const flushFrames = () => frames.splice(0).forEach((cb) => cb(0));
    const setRoot = (scrollHeight: number, scrollY: number) => {
        Object.defineProperty(root, 'scrollHeight', { value: scrollHeight, configurable: true });
        Object.defineProperty(root, 'clientHeight', { value: 852, configurable: true });
        Object.defineProperty(window, 'scrollY', { value: scrollY, configurable: true });
    };
    const rect = (el: Element, top: number, bottom: number) =>
        vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ top, bottom } as DOMRect);
    /** A scrolling container 852px tall holding `field` with its bottom edge at 700px. */
    const mountField = (field: HTMLElement) => {
        const scroller = document.createElement('div');
        scroller.style.overflowY = 'auto';
        Object.defineProperty(scroller, 'scrollHeight', { value: 1200, configurable: true });
        Object.defineProperty(scroller, 'clientHeight', { value: 852, configurable: true });
        rect(scroller, 0, 852);
        rect(field, 656, 700);
        scroller.append(field);
        document.body.append(scroller);
        field.focus();
        return scroller;
    };

    beforeEach(() => {
        frames = [];
        vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => frames.push(cb));
        vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
        cleanup = keepPageInPlace();
    });

    afterEach(() => {
        cleanup();
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        document.body.replaceChildren();
        for (const key of ['scrollHeight', 'clientHeight']) delete (root as unknown as Record<string, unknown>)[key];
        delete (window as unknown as Record<string, unknown>).scrollY;
    });

    it('should scroll a page that fits the window back to the top', () => {
        setRoot(852, 118);
        window.dispatchEvent(new Event('scroll'));
        expect(window.scrollTo).toHaveBeenCalledWith(0, 0);
    });

    it('should leave the scroll of a page taller than the window', () => {
        setRoot(2400, 118);
        window.dispatchEvent(new Event('scroll'));
        vv.dispatchEvent(new Event('scroll'));
        expect(window.scrollTo).not.toHaveBeenCalled();
    });

    it('should scroll the focused field clear of the keyboard in its own container', () => {
        setRoot(852, 0);
        const scroller = mountField(document.createElement('input'));
        vv.set({ height: 450 });
        flushFrames();
        // The field's bottom (700) ends 16px above the keyboard's top (450).
        expect(scroller.scrollTop).toBe(266);
    });

    it('should leave the container while the keyboard is down', () => {
        setRoot(852, 0);
        const scroller = mountField(document.createElement('textarea'));
        flushFrames();
        expect(scroller.scrollTop).toBe(0);
    });

    it('should leave the editor, which keeps its own caret clear of the keyboard', () => {
        setRoot(852, 0);
        const editor = document.createElement('div');
        editor.contentEditable = 'true';
        editor.tabIndex = 0;
        const scroller = mountField(editor);
        vv.set({ height: 450 });
        flushFrames();
        expect(scroller.scrollTop).toBe(0);
    });

    it('should stop once cleaned up', () => {
        cleanup();
        setRoot(852, 118);
        window.dispatchEvent(new Event('scroll'));
        expect(window.scrollTo).not.toHaveBeenCalled();
    });
});
