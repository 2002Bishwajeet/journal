// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { hiddenEdges, shouldPin, trackScrollShade } from '@/lib/editor/scrollShade';

// #1389: a table wider than the note column shows a shade on each edge that has hidden content.

describe('hiddenEdges', () => {
  it('hides nothing when the table fits', () => {
    expect(hiddenEdges(0, 600, 600)).toEqual({ start: false, end: false });
  });

  it('hides the right edge at the start', () => {
    expect(hiddenEdges(0, 300, 900)).toEqual({ start: false, end: true });
  });

  it('hides both edges in the middle', () => {
    expect(hiddenEdges(200, 300, 900)).toEqual({ start: true, end: true });
  });

  it('hides the left edge at the end', () => {
    expect(hiddenEdges(600, 300, 900)).toEqual({ start: true, end: false });
  });

  it('ignores a sub-pixel gap at either end', () => {
    expect(hiddenEdges(0.5, 300, 300.5)).toEqual({ start: false, end: false });
    expect(hiddenEdges(599.5, 300, 900)).toEqual({ start: true, end: false });
  });
});

// #1390: the first column stays in view while a table wider than the note column scrolls.
describe('shouldPin', () => {
  it('pins a narrow first column of a table that overflows', () => {
    expect(shouldPin(true, 112, 358, false)).toBe(true);
  });

  it('does not pin when the table fits', () => {
    expect(shouldPin(false, 112, 358, false)).toBe(false);
  });

  it('does not pin a first column wider than 40% of the wrapper', () => {
    expect(shouldPin(true, 144, 358, false)).toBe(false);
    expect(shouldPin(true, 143, 358, false)).toBe(true);
  });

  it('keeps a pinned column pinned within 2px of the limit', () => {
    expect(shouldPin(true, 144, 358, true)).toBe(true);
    expect(shouldPin(true, 146, 358, true)).toBe(false);
  });
});

describe('trackScrollShade', () => {
  const observers: { callback: () => void; observed: Element[]; disconnect: () => void }[] = [];

  afterEach(() => {
    observers.length = 0;
    vi.unstubAllGlobals();
  });

  function wrapper(size: { client: number; scroll: number }) {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observed: Element[] = [];
        disconnect = vi.fn();
        callback: () => void;
        constructor(callback: () => void) {
          this.callback = callback;
          observers.push(this);
        }
        observe(el: Element) {
          this.observed.push(el);
        }
      },
    );
    const el = document.createElement('div');
    el.appendChild(document.createElement('table'));
    Object.defineProperty(el, 'clientWidth', { get: () => size.client });
    Object.defineProperty(el, 'scrollWidth', { get: () => size.scroll });
    return el;
  }

  const shade = (el: HTMLElement) => [el.hasAttribute('data-shade-start'), el.hasAttribute('data-shade-end')];

  it('marks only the end at the start of a table that overflows', () => {
    const el = wrapper({ client: 300, scroll: 900 });
    trackScrollShade(el);
    expect(shade(el)).toEqual([false, true]);
  });

  it('follows the scroll position', () => {
    const el = wrapper({ client: 300, scroll: 900 });
    trackScrollShade(el);
    el.scrollLeft = 200;
    el.dispatchEvent(new Event('scroll'));
    expect(shade(el)).toEqual([true, true]);
    el.scrollLeft = 600;
    el.dispatchEvent(new Event('scroll'));
    expect(shade(el)).toEqual([true, false]);
  });

  it('marks nothing when the table fits, and clears the marks once it does', () => {
    const size = { client: 300, scroll: 900 };
    const el = wrapper(size);
    trackScrollShade(el);
    size.scroll = 300;
    observers[0].callback();
    expect(shade(el)).toEqual([false, false]);
  });

  it('watches the wrapper and its table, and stops on cleanup', () => {
    const el = wrapper({ client: 300, scroll: 900 });
    const stop = trackScrollShade(el) as () => void;
    expect(observers[0].observed).toEqual([el, el.firstElementChild]);
    stop();
    expect(observers[0].disconnect).toHaveBeenCalled();
    el.scrollLeft = 200;
    el.dispatchEvent(new Event('scroll'));
    expect(shade(el)).toEqual([false, true]);
  });

  describe('pin', () => {
    function tableWrapper(size: { client: number; scroll: number }, firstWidth: number, optIn = true) {
      const el = wrapper(size);
      el.toggleAttribute('data-pin-first', optIn);
      const cell = document.createElement('td');
      cell.getBoundingClientRect = () => ({ width: firstWidth }) as DOMRect;
      const row = document.createElement('tr');
      row.appendChild(cell);
      el.firstElementChild!.appendChild(row);
      return el;
    }

    it('pins the first column of a table that overflows', () => {
      const el = tableWrapper({ client: 300, scroll: 900 }, 100);
      trackScrollShade(el);
      expect(el.hasAttribute('data-pin')).toBe(true);
    });

    it('does not pin a table that has not opted in', () => {
      const el = tableWrapper({ client: 300, scroll: 900 }, 100, false);
      trackScrollShade(el);
      expect(el.hasAttribute('data-pin')).toBe(false);
      expect(el.hasAttribute('data-shade-end')).toBe(true);
    });

    it('does not pin a table that fits, and unpins one that comes to fit', () => {
      const size = { client: 300, scroll: 900 };
      const el = tableWrapper(size, 100);
      trackScrollShade(el);
      size.scroll = 300;
      observers[0].callback();
      expect(el.hasAttribute('data-pin')).toBe(false);
    });

    it('does not pin a first column wider than 40% of the wrapper', () => {
      const el = tableWrapper({ client: 300, scroll: 900 }, 130);
      trackScrollShade(el);
      expect(el.hasAttribute('data-pin')).toBe(false);
    });

    it('pins a headerless table, whose first cell is a td', () => {
      const el = tableWrapper({ client: 300, scroll: 900 }, 100);
      expect(el.querySelector('td')).not.toBeNull();
      trackScrollShade(el);
      expect(el.hasAttribute('data-pin')).toBe(true);
    });
  });

  it('does nothing without an element', () => {
    expect(trackScrollShade(null)).toBeUndefined();
  });
});

// The editor and the share page use the same `.prose` rules (#447).
const css = readFileSync('src/index.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (selector: string) => css.match(new RegExp(`${selector.replace(/[.\s[\]()*:"]/g, (c) => `\\${c}`)}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('table styles', () => {
  it('cap the width of a cell, and give a resized table its dragged widths back', () => {
    expect(rule('.prose th, .prose td')).toMatch(/max-width:\s*22rem/);
    expect(rule('.prose th, .prose td')).toMatch(/min-width:\s*7rem/);
    expect(rule('.prose table:has(> colgroup > col[style*="width"]:not([style*="min-width"])) :is(th, td)')).toMatch(/max-width:\s*none/);
  });

  it('pin the first column of a table that overflows, opaque and above the scrolling cells', () => {
    expect(rule('.prose .tableWrapper[data-pin] :is(th, td):first-child')).toMatch(/position:\s*sticky/);
    expect(rule('.prose .tableWrapper[data-pin] :is(th, td):first-child')).toMatch(/left:\s*0/);
    expect(rule('.prose .tableWrapper[data-pin] td:first-child')).toMatch(/background:\s*var\(--background\)/);
    expect(rule('.prose .tableWrapper[data-pin] table')).toMatch(/border-collapse:\s*separate/);
    expect(rule('.prose .tableWrapper[data-pin][data-shade-start]')).toMatch(/mask-image:\s*none/);
  });

  it('fade the wrapper edge that has hidden content,', () => {
    for (const selector of ['.prose .tableWrapper[data-shade-end]', '.prose .tableWrapper[data-shade-start]', '.prose .tableWrapper[data-shade-start][data-shade-end]']) {
      expect(rule(selector)).toMatch(/(?<!-webkit-)mask-image:\s*linear-gradient/);
      expect(rule(selector)).toMatch(/-webkit-mask-image:\s*linear-gradient/);
    }
  });
});
