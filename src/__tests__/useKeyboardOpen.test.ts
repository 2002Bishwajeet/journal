// @vitest-environment happy-dom
/**
 * The phone's tab bar leaves the screen while the software keyboard is up (#853).
 * iOS shrinks only the visual viewport for the keyboard, so the hook compares it with the window.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useKeyboardOpen } from '@/hooks/useKeyboardOpen';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
let root: Root;
let host: HTMLElement;

function Probe() {
    return h('span', null, String(useKeyboardOpen()));
}

beforeEach(() => {
    vv = new FakeViewport();
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 852, configurable: true });
    host = document.createElement('div');
    root = createRoot(host);
    act(() => root.render(h(Probe)));
});

afterEach(() => {
    act(() => root.unmount());
});

describe('useKeyboardOpen', () => {
    it('is false while the whole window is visible', () => {
        expect(host.textContent).toBe('false');
    });

    it('is true while the visual viewport is shorter than the window, and false again when the keyboard closes', () => {
        act(() => vv.set({ height: 450 }));
        expect(host.textContent).toBe('true');
        act(() => vv.set({ height: 852 }));
        expect(host.textContent).toBe('false');
    });

    it('counts the part of the viewport scrolled off the top', () => {
        act(() => vv.set({ height: 400, offsetTop: 52 }));
        expect(host.textContent).toBe('true');
        act(() => vv.set({ height: 800, offsetTop: 52 }));
        expect(host.textContent).toBe('false');
    });

    it('ignores a pinch zoom, which shrinks the visual viewport too', () => {
        act(() => vv.set({ height: 426, scale: 2 }));
        expect(host.textContent).toBe('false');
    });
});
