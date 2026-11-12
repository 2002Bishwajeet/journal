/** #1014: the quick-capture text -> note mapping and the shortcut picker's helpers. */
import { describe, it, expect } from 'vitest';
import {
    acceleratorFromEvent,
    displayShortcut,
    isWaylandSession,
    splitCapture,
} from '@/lib/quickCapture';

describe('splitCapture', () => {
    it('uses the first line as the title and the rest as the body', () => {
        expect(splitCapture('Buy milk\nand eggs\n\nand bread')).toEqual({
            title: 'Buy milk',
            content: 'and eggs\n\nand bread',
        });
    });

    it('makes a one-line capture a title with an empty body', () => {
        expect(splitCapture('Just a title')).toEqual({ title: 'Just a title', content: '' });
    });

    it('trims the title, the body and the surrounding blank lines', () => {
        expect(splitCapture('\n\n  Title  \n\n  body  \n\n')).toEqual({ title: 'Title', content: 'body' });
    });

    it('does nothing for empty or whitespace-only input', () => {
        expect(splitCapture('')).toBeNull();
        expect(splitCapture('   \n\t \n')).toBeNull();
    });
});

describe('isWaylandSession', () => {
    it('is true only for a Wayland session', () => {
        expect(isWaylandSession('wayland')).toBe(true);
        expect(isWaylandSession('Wayland')).toBe(true);
        expect(isWaylandSession('x11')).toBe(false);
        expect(isWaylandSession('')).toBe(false);
    });
});

describe('acceleratorFromEvent', () => {
    const press = (over: Partial<Parameters<typeof acceleratorFromEvent>[0]>) => ({
        code: 'KeyJ',
        key: 'j',
        ctrlKey: false,
        metaKey: false,
        altKey: false,
        shiftKey: false,
        ...over,
    });

    it('names modifiers and the key', () => {
        expect(acceleratorFromEvent(press({ ctrlKey: true, shiftKey: true }), false)).toBe('Ctrl+Shift+J');
        expect(acceleratorFromEvent(press({ metaKey: true, altKey: true, code: 'Digit1' }), true)).toBe('Cmd+Alt+1');
        expect(acceleratorFromEvent(press({ metaKey: true, code: 'ArrowUp' }), false)).toBe('Super+Up');
    });

    it('ignores a modifier on its own, a bare key and an unnameable key', () => {
        expect(acceleratorFromEvent(press({ key: 'Control', code: 'ControlLeft', ctrlKey: true }), false)).toBeNull();
        expect(acceleratorFromEvent(press({}), false)).toBeNull();
        expect(acceleratorFromEvent(press({ ctrlKey: true, code: 'MediaPlayPause' }), false)).toBeNull();
    });
});

describe('displayShortcut', () => {
    it('spells out the platform key', () => {
        expect(displayShortcut('CmdOrCtrl+Shift+J', false)).toBe('Ctrl + Shift + J');
        expect(displayShortcut('CmdOrCtrl+Shift+J', true)).toBe('Cmd + Shift + J');
    });
});
