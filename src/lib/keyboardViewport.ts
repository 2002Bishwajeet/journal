import { getCaretScrollDelta, getLayoutOffsetTop } from '@/lib/editor/keyboardOffset';

/**
 * Ref callback for a fixed, centred box (DialogContent). iOS Safari shrinks only the visual
 * viewport for the software keyboard, so `dvh` and fixed layouts ignore it. While the keyboard
 * is up this sets `--dialog-top` (the centre of what is left on screen) and `--dialog-max-h`
 * (its height) on the element; with the keyboard down it clears them. It writes the style
 * directly, so it needs no React render to follow the keyboard.
 */
export function followKeyboard(el: HTMLElement | null): (() => void) | undefined {
    const vv = window.visualViewport;
    if (!el || !vv) return;
    const update = () => {
        // A pinch zoom shrinks the visual viewport too; only follow it at 1x.
        const up = vv.scale === 1 && vv.height < window.innerHeight - 1;
        const top = getLayoutOffsetTop(vv.offsetTop, document.documentElement.clientHeight, window.innerHeight);
        el.style.setProperty('--dialog-top', up ? `${top + vv.height / 2}px` : '');
        el.style.setProperty('--dialog-max-h', up ? `${vv.height}px` : '');
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
    };
}

/**
 * Ref callback for a sheet fixed to the bottom of the screen (SheetContent). iOS Safari does not
 * shrink the layout viewport for the keyboard, so a bottom-anchored sheet would sit behind it.
 * This sets `--sheet-bottom` (the gap between the visual viewport's bottom edge and the window's)
 * and `--sheet-h` (the visual viewport's height) on the element, so the sheet sits on the keyboard
 * and fits above it. There is no "keyboard up" test: when Safari scrolls the page to a focused
 * field it can also shrink `innerHeight` to the visual viewport, so comparing the two misses the
 * keyboard. A pinch zoom clears them.
 */
export function followKeyboardBottom(el: HTMLElement | null): (() => void) | undefined {
    const vv = window.visualViewport;
    if (!el || !vv) return;
    const update = () => {
        const follow = vv.scale === 1;
        const top = getLayoutOffsetTop(vv.offsetTop, document.documentElement.clientHeight, window.innerHeight);
        el.style.setProperty('--sheet-bottom', follow ? `${Math.max(0, window.innerHeight - top - vv.height)}px` : '');
        el.style.setProperty('--sheet-h', follow ? `${vv.height}px` : '');
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
    };
}

/**
 * Keeps the page still for the software keyboard (#1300). iOS (Safari and the app's WKWebView)
 * shrinks only the visual viewport and scrolls the whole page to show a focused field, which takes
 * every top bar off screen with it. A page that fits the window never needs that scroll, so it is
 * undone at once: screens scroll inside their own containers, and sheets and dialogs already fit
 * what is left above the keyboard (followKeyboard, followKeyboardBottom). Instead, the focused
 * input or textarea is scrolled clear of the keyboard in its own container; the editor's caret has
 * its own (scrollCaretAboveKeyboard). A page taller than the window (a public share page) keeps its
 * scroll. In the iOS app the native shell already stops that scroll before it is drawn
 * (src-tauri/src/ios_keyboard.rs); this undo is for Safari, where it shows for a moment.
 * Returns the cleanup.
 */
export function keepPageInPlace(): () => void {
    const vv = window.visualViewport;
    const root = document.documentElement;
    let frame = 0;
    const hold = () => {
        if ((window.scrollY || window.scrollX) && root.scrollHeight <= root.clientHeight) window.scrollTo(0, 0);
    };
    // A frame later, so a sheet or dialog has shrunk for the keyboard and its container can scroll.
    const reveal = () => {
        frame = 0;
        const field = document.activeElement;
        if (!vv || vv.scale !== 1 || vv.height >= window.innerHeight - 1) return;
        if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) return;
        let scroller = field.parentElement;
        while (scroller && !(scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(getComputedStyle(scroller).overflowY))) {
            scroller = scroller.parentElement;
        }
        if (!scroller) return;
        const top = getLayoutOffsetTop(vv.offsetTop, root.clientHeight, window.innerHeight);
        const delta = getCaretScrollDelta(field.getBoundingClientRect().bottom, scroller.getBoundingClientRect().bottom, top + vv.height, null);
        scroller.scrollTop += Math.ceil(delta); // whole px: scrollTop rounds to the device pixel
    };
    const schedule = () => {
        if (!frame) frame = requestAnimationFrame(reveal);
    };
    const onResize = () => {
        hold();
        schedule();
    };
    window.addEventListener('scroll', hold);
    document.addEventListener('focusin', schedule);
    vv?.addEventListener('scroll', hold);
    vv?.addEventListener('resize', onResize);
    return () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('scroll', hold);
        document.removeEventListener('focusin', schedule);
        vv?.removeEventListener('scroll', hold);
        vv?.removeEventListener('resize', onResize);
    };
}
