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
