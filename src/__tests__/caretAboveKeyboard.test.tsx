// @vitest-environment happy-dom
/**
 * The caret stays clear of the keyboard toolbar when the keyboard opens, not only
 * while typing. Numbers measured on an iPhone 15 in the iOS app (WKWebView): after a
 * tap on a low line, the keyboard opened and WebKit scrolled the page by 10px, so
 * the caret line (bottom 516) sat behind the toolbar (top 459).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { getCaretScrollDelta, getLayoutOffsetTop, scrollCaretAboveKeyboard } from '@/lib/editor/keyboardOffset';
import { useKeyboardOffset } from '@/hooks/useKeyboardOffset';

class FakeViewport extends EventTarget {
  height = 852;
  offsetTop = 0;
  scale = 1;
}

const rect = (top: number, bottom: number) => ({ top, bottom, left: 0, right: 393, width: 393, height: bottom - top, x: 0, y: top }) as DOMRect;

let vv: FakeViewport;
let scroller: HTMLElement;
let editorDom: HTMLElement;
let toolbar: HTMLElement;
let caretBottom: number;

// Mounts a component that only runs the hook; React flushes its effect inside act.
function mountHook() {
  const Probe = () => {
    useKeyboardOffset(true, editorDom);
    return null;
  };
  const root = createRoot(document.createElement('div'));
  act(() => root.render(<Probe />));
  return root;
}

beforeEach(() => {
  vv = new FakeViewport();
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 852, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 852, configurable: true });
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    cb(0);
    return 1;
  });

  document.body.innerHTML =
    '<div class="overflow-y-auto"><div class="ProseMirror"><p>one</p><p id="last">last</p></div></div>' +
    '<div data-mobile-toolbar></div>';
  scroller = document.querySelector('.overflow-y-auto')!;
  editorDom = document.querySelector('.ProseMirror')!;
  toolbar = document.querySelector('[data-mobile-toolbar]')!;
  scroller.getBoundingClientRect = () => rect(-10, 808);
  toolbar.getBoundingClientRect = () => rect(459, 524);
  caretBottom = 516;
  const text = document.getElementById('last')!.firstChild!;
  const range = document.createRange();
  range.setStart(text, 2);
  vi.spyOn(Range.prototype, 'getClientRects').mockImplementation(
    () => [rect(caretBottom - 20, caretBottom)] as unknown as DOMRectList,
  );
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (document.documentElement as { clientHeight?: number }).clientHeight;
});

describe('getCaretScrollDelta in the iOS app', () => {
  it('measures the keyboard top inside the shrunk layout viewport, not offsetTop + height', () => {
    const viewportBottom = getLayoutOffsetTop(10, 852, 842) + 524;
    expect(viewportBottom).toBe(524);
    expect(getCaretScrollDelta(516, 808, viewportBottom, null)).toBe(516 - (524 - 16));
    expect(getCaretScrollDelta(516, 808, viewportBottom, 459)).toBe(516 - (459 - 16));
  });
});

describe('scrollCaretAboveKeyboard', () => {
  it('scrolls the caret line 16px above the toolbar', () => {
    expect(scrollCaretAboveKeyboard(editorDom)).toBe(true);
    expect(scroller.scrollTop).toBe(516 - (459 - 16));
  });

  it('leaves a caret that is already clear alone', () => {
    caretBottom = 300;
    expect(scrollCaretAboveKeyboard(editorDom)).toBe(false);
    expect(scroller.scrollTop).toBe(0);
  });

  it('does nothing when the selection is outside the editor', () => {
    const outside = document.createElement('input');
    document.body.append(outside);
    const range = document.createRange();
    range.selectNode(outside);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    expect(scrollCaretAboveKeyboard(editorDom)).toBe(false);
  });
});

describe('useKeyboardOffset', () => {
  it('scrolls the caret clear when the keyboard opens, with no transaction in the editor', () => {
    toolbar.getBoundingClientRect = () => rect(787, 852);
    mountHook();
    expect(scroller.scrollTop).toBe(0);

    // The keyboard opens and WebKit scrolls the page by 10px: innerHeight 842, offsetTop 10.
    Object.defineProperty(window, 'innerHeight', { value: 842, configurable: true });
    vv.height = 524;
    vv.offsetTop = 10;
    toolbar.getBoundingClientRect = () => rect(459, 524);
    vv.dispatchEvent(new Event('resize'));
    expect(document.documentElement.style.getPropertyValue('--keyboard-offset')).toBe('318px');
    // Room under the last line for the floating toolbar: 8px gap + 58px toolbar.
    expect(document.documentElement.style.getPropertyValue('--editor-bottom-space')).toBe('384px');
    expect(scroller.scrollTop).toBe(516 - (459 - 16));
  });

  it('does not pull the note back to the caret on events that move nothing', () => {
    mountHook();
    const first = scroller.scrollTop;
    scroller.scrollTop = 0; // the reader scrolled away from the caret
    vv.dispatchEvent(new Event('scroll'));
    expect(first).toBeGreaterThan(0);
    expect(scroller.scrollTop).toBe(0);
  });
});

/**
 * #1300: the iOS app no longer lets WebKit scroll the page for the keyboard, so innerHeight stays
 * put. iPhone 17 simulator: 874pt screen, 301pt keyboard (top 573), toolbar 507-565. Focus moves
 * into the note before the tap puts the caret on its line, and the toolbar is already held at the
 * last keyboard height, so the keyboard arriving changes only the visible height.
 */
describe('useKeyboardOffset when the keyboard arrives at the held height', () => {
  beforeEach(() => {
    vv.height = 874;
    Object.defineProperty(window, 'innerHeight', { value: 874, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 402, configurable: true });
    Object.defineProperty(document.documentElement, 'clientHeight', { value: 874, configurable: true });
    scroller.getBoundingClientRect = () => rect(0, 874);
    toolbar.getBoundingClientRect = () => rect(507, 565);
    // An earlier focus saw the 301pt keyboard (the hook keeps it per window width).
    caretBottom = 300;
    const earlier = mountHook();
    vv.height = 573;
    vv.dispatchEvent(new Event('resize'));
    act(() => earlier.unmount());
    vv.height = 874;
  });

  it('scrolls a caret below the toolbar and keyboard clear of both', () => {
    mountHook();
    expect(document.documentElement.style.getPropertyValue('--keyboard-offset')).toBe('301px');
    caretBottom = 587; // the tap lands on a low line
    vv.height = 573;
    vv.dispatchEvent(new Event('resize'));
    expect(scroller.scrollTop).toBe(587 - (507 - 16));
  });

  it('leaves a caret that is already clear alone', () => {
    mountHook();
    caretBottom = 400;
    vv.height = 573;
    vv.dispatchEvent(new Event('resize'));
    expect(scroller.scrollTop).toBe(0);
  });
});
