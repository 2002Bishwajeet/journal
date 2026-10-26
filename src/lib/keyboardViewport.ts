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
        el.style.setProperty('--dialog-top', up ? `${vv.offsetTop + vv.height / 2}px` : '');
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
 * While the keyboard is up this sets `--sheet-bottom` (the gap between the visual viewport's
 * bottom edge and the window's) and `--sheet-h` (the visual viewport's height) on the element;
 * with the keyboard down it clears them.
 */
export function followKeyboardBottom(el: HTMLElement | null): (() => void) | undefined {
    const vv = window.visualViewport;
    if (!el || !vv) return;
    const update = () => {
        const up = vv.scale === 1 && vv.height < window.innerHeight - 1;
        el.style.setProperty('--sheet-bottom', up ? `${Math.max(0, window.innerHeight - vv.offsetTop - vv.height)}px` : '');
        el.style.setProperty('--sheet-h', up ? `${vv.height}px` : '');
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
    };
}
