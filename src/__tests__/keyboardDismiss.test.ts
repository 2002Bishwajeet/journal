// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { canStartDismissDrag, isDismissDrag, DISMISS_DRAG_DISTANCE, LONG_PRESS_MS } from '@/lib/editor/keyboardDismiss';

describe('isDismissDrag', () => {
  it('closes the keyboard once the finger has moved down far enough', () => {
    expect(isDismissDrag(0, DISMISS_DRAG_DISTANCE, 0)).toBe(true);
    expect(isDismissDrag(10, 120, 80)).toBe(true);
  });

  it('ignores a small scroll while typing', () => {
    expect(isDismissDrag(0, DISMISS_DRAG_DISTANCE - 1, 0)).toBe(false);
    expect(isDismissDrag(2, 20, 0)).toBe(false);
  });

  it('ignores an upward drag', () => {
    expect(isDismissDrag(0, -200, 0)).toBe(false);
  });

  it('ignores a sideways or diagonal drag', () => {
    expect(isDismissDrag(200, 10, 0)).toBe(false);
    expect(isDismissDrag(40, 60, 0)).toBe(false);
    expect(isDismissDrag(-40, 60, 0)).toBe(false);
  });

  it('ignores a long press that turns into a drag (text selection)', () => {
    expect(isDismissDrag(0, 200, LONG_PRESS_MS)).toBe(false);
    expect(isDismissDrag(0, 200, LONG_PRESS_MS - 1)).toBe(true);
  });
});

describe('canStartDismissDrag', () => {
  const mount = (html: string) => {
    document.body.innerHTML = html;
    return (selector: string) => document.querySelector(selector);
  };

  it('starts on note text', () => {
    const $ = mount('<div class="ProseMirror"><p><span id="t">text</span></p></div>');
    expect(canStartDismissDrag($('#t'))).toBe(true);
  });

  it('never starts in the toolbar, a sheet or a popover', () => {
    const $ = mount(
      '<div data-mobile-toolbar><button id="b"><svg id="i"></svg></button></div>' +
        '<div data-slot="sheet-content"><p id="s">x</p></div>' +
        '<div data-radix-popper-content-wrapper><p id="p">x</p></div>',
    );
    expect(canStartDismissDrag($('#b'))).toBe(false);
    expect(canStartDismissDrag($('#i'))).toBe(false);
    expect(canStartDismissDrag($('#s'))).toBe(false);
    expect(canStartDismissDrag($('#p'))).toBe(false);
  });

  it('never starts in a code block, table or live block', () => {
    const $ = mount(
      '<div class="ProseMirror"><pre><code id="c">x</code></pre>' +
        '<div class="tableWrapper"><table><tbody><tr><td id="td">x</td></tr></tbody></table></div>' +
        '<div data-live-block="html"><div id="l">x</div></div></div>',
    );
    expect(canStartDismissDrag($('#c'))).toBe(false);
    expect(canStartDismissDrag($('#td'))).toBe(false);
    expect(canStartDismissDrag($('#l'))).toBe(false);
  });

  it('ignores a target that is not an element', () => {
    expect(canStartDismissDrag(null)).toBe(false);
    expect(canStartDismissDrag(window)).toBe(false);
  });
});
