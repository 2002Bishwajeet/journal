// @vitest-environment happy-dom
/**
 * #1272: on iOS the keyboard is reported ~150 ms after focus moves into the note (or the Aa
 * panel closes). The toolbar keeps the last keyboard height until then instead of dropping to
 * the bottom of the screen, and with no height known yet it waits hidden and fades in.
 * Numbers from the iPhone 17e simulator: 844pt screen, 301pt keyboard.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot, type Root } from 'react-dom/client';
import { getHeldKeyboardOffset, KEYBOARD_SETTLE_MS } from '@/lib/editor/keyboardOffset';
import { useKeyboardOffset } from '@/hooks/useKeyboardOffset';

describe('getHeldKeyboardOffset', () => {
  it('keeps the last keyboard height while the keyboard is still on its way', () => {
    expect(getHeldKeyboardOffset(0, 301, true)).toBe(301);
  });

  it('is unknown while waiting when no keyboard was seen yet', () => {
    expect(getHeldKeyboardOffset(0, null, true)).toBeNull();
  });

  it('follows the keyboard once it is up or no longer expected', () => {
    expect(getHeldKeyboardOffset(290, 301, true)).toBe(290);
    expect(getHeldKeyboardOffset(0, 301, false)).toBe(0);
    expect(getHeldKeyboardOffset(0, null, false)).toBe(0);
  });
});

class FakeViewport extends EventTarget {
  height = 844;
  offsetTop = 0;
  scale = 1;
}

let vv: FakeViewport;
let roots: Root[] = [];
const style = document.documentElement.style;
const offset = () => style.getPropertyValue('--keyboard-offset');

function mount(enabled = true) {
  const editorDom = document.createElement('div');
  const Probe = ({ on }: { on: boolean }) => {
    useKeyboardOffset(on, editorDom);
    return null;
  };
  const root = createRoot(document.createElement('div'));
  roots.push(root);
  act(() => root.render(<Probe on={enabled} />));
  return (on: boolean) => act(() => root.render(<Probe on={on} />));
}

const keyboard = (height: number) => {
  vv.height = 844 - height;
  vv.dispatchEvent(new Event('resize'));
};

beforeEach(() => {
  vi.useFakeTimers();
  vv = new FakeViewport();
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 844, configurable: true });
  Object.defineProperty(window, 'innerWidth', { value: 390, configurable: true });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)');
  // Runs the frame at once; 0 so the hook sees no frame pending afterwards.
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
});

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useKeyboardOffset while the keyboard comes up', () => {
  it('on the first focus of the page, hides the toolbar until the keyboard arrives, then fades it in on it', () => {
    // Its own window width, so no keyboard is known yet.
    Object.defineProperty(window, 'innerWidth', { value: 391, configurable: true });
    mount();
    expect(style.getPropertyValue('--keyboard-toolbar-opacity')).toBe('0');
    keyboard(301);
    expect(offset()).toBe('301px');
    expect(style.getPropertyValue('--keyboard-toolbar-opacity')).toBe('1');
    expect(style.getPropertyValue('--keyboard-transition')).toContain('opacity');
  });

  it('keeps the last keyboard height when focus comes back (Aa Close), with no drop before the keyboard', () => {
    const set = mount();
    keyboard(301);
    // The Aa panel takes focus: the keyboard goes down and the hook stops.
    set(false);
    keyboard(0);
    // Close: focus is back in the note, the keyboard is not reported yet.
    set(true);
    expect(offset()).toBe('301px');
    expect(style.getPropertyValue('--keyboard-toolbar-opacity')).toBe('1');
    vi.advanceTimersByTime(130);
    expect(offset()).toBe('301px');
    keyboard(301);
    expect(offset()).toBe('301px');
    expect(style.getPropertyValue('--keyboard-transition')).toBe('');
  });

  it('eases to the real keyboard when it comes up at another height', () => {
    const set = mount();
    keyboard(301);
    set(false);
    keyboard(0);
    set(true);
    keyboard(345); // the emoji keyboard
    expect(offset()).toBe('345px');
    expect(style.getPropertyValue('--keyboard-transition')).toContain('bottom');
    vi.advanceTimersByTime(300);
    expect(style.getPropertyValue('--keyboard-transition')).toBe('');
  });

  it('lets go when no keyboard comes (a hardware keyboard)', () => {
    const set = mount();
    keyboard(301);
    set(false);
    keyboard(0);
    set(true);
    vi.advanceTimersByTime(KEYBOARD_SETTLE_MS);
    expect(offset()).toBe('0px');
  });

  it('does not animate the toolbar on later keyboard moves', () => {
    mount();
    keyboard(301);
    vi.advanceTimersByTime(KEYBOARD_SETTLE_MS + 300);
    keyboard(345);
    expect(offset()).toBe('345px');
    expect(style.getPropertyValue('--keyboard-transition')).toBe('');
  });

  it('on Android, where the layout resizes, never hides or holds the toolbar', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 15; Pixel 7)');
    Object.defineProperty(window, 'innerWidth', { value: 412, configurable: true });
    mount();
    expect(offset()).toBe('0px');
    expect(style.getPropertyValue('--keyboard-toolbar-opacity')).toBe('1');
  });
});
