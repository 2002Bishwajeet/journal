// @vitest-environment happy-dom
/**
 * Dialogs follow the iOS software keyboard (#783): while the visual viewport is
 * shorter than the window, the dialog gets the centre and height of what is left.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { followKeyboard } from '@/lib/keyboardViewport';

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
