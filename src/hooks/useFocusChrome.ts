import { useEffect, useRef, useState } from 'react';

/** How long the exit pill shows on entering focus mode, so the user learns how to leave. */
export const FOCUS_PEEK_MS = 2000;
/** How long it stays once the user asks for it, counted from their last interaction with it. */
export const FOCUS_SHOW_MS = 3500;
/** A mouse this close to the top of the window asks for the chrome. */
export const FOCUS_EDGE_PX = 4;
/** While shown, a pointer in this much of the top keeps it shown. */
export const FOCUS_ZONE_PX = 120;

/** A menu opened from the revealed toolbar lives outside it; hiding the toolbar would pull it away. */
const MENU_OPEN = '[role="menu"], [data-radix-popper-content-wrapper]';

/**
 * The exit pill and the narrow-window toolbar in focus mode (#1391). Focus mode is full focus: they
 * show for a moment on entering, then only when asked for. Scrolling and typing never bring them
 * back. A mouse at the top edge of the window asks; on touch the layout's top strip calls `reveal`.
 * Once shown they hide again after a few idle seconds.
 */
export function useFocusChrome(active: boolean): { shown: boolean; reveal: () => void } {
    const [shown, setShown] = useState(false);
    const revealRef = useRef(() => {});

    useEffect(() => {
        if (!active) return;
        let timer: ReturnType<typeof setTimeout>;
        let visible = false;
        const show = (ms: number) => {
            visible = true;
            setShown(true);
            clearTimeout(timer);
            timer = setTimeout(function hide() {
                if (document.querySelector(MENU_OPEN)) {
                    timer = setTimeout(hide, ms);
                    return;
                }
                visible = false;
                setShown(false);
            }, ms);
        };
        revealRef.current = () => show(FOCUS_SHOW_MS);

        const onPointer = (e: PointerEvent) => {
            if (e.pointerType !== 'touch' && e.clientY <= FOCUS_EDGE_PX) show(FOCUS_SHOW_MS);
            else if (visible && (e.clientY <= FOCUS_ZONE_PX || (e.target as Element | null)?.closest?.(MENU_OPEN))) {
                show(FOCUS_SHOW_MS);
            }
        };
        window.addEventListener('pointermove', onPointer);
        window.addEventListener('pointerdown', onPointer);
        show(FOCUS_PEEK_MS);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('pointermove', onPointer);
            window.removeEventListener('pointerdown', onPointer);
        };
    }, [active]);

    return { shown: active && shown, reveal: () => revealRef.current() };
}
