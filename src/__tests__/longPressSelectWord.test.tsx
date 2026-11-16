// @vitest-environment happy-dom
/** #1272: a stationary long press on a word selects it (and brings up the format bar), like Apple Notes. */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Editor } from '@tiptap/react';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { getWordAt, isLongPress, LONG_PRESS_MS } from '@/lib/editor/mobileBar';
import { useLongPressSelectWord } from '@/hooks/useLongPressSelectWord';

describe('getWordAt', () => {
  it('returns the word around the offset', () => {
    expect(getWordAt('quick brown fox', 8)).toEqual([6, 11]);
    expect(getWordAt('quick brown fox', 6)).toEqual([6, 11]);
  });

  it('takes the word just before the offset, where a press on its last letter lands', () => {
    expect(getWordAt('quick brown fox', 11)).toEqual([6, 11]);
    expect(getWordAt('quick brown fox', 15)).toEqual([12, 15]);
  });

  it('returns null off a word', () => {
    expect(getWordAt('a  -  b', 3)).toBeNull();
    expect(getWordAt('', 0)).toBeNull();
  });

  it('keeps apostrophes and non-Latin words whole', () => {
    expect(getWordAt("don't stop", 2)).toEqual([0, 5]);
    expect(getWordAt('Grüße aus Köln', 12)).toEqual([10, 14]);
  });
});

describe('isLongPress', () => {
  it('needs the hold time and a finger that stayed put', () => {
    expect(isLongPress(LONG_PRESS_MS, 0)).toBe(true);
    expect(isLongPress(LONG_PRESS_MS - 1, 0)).toBe(false);
    expect(isLongPress(900, 10)).toBe(true);
    expect(isLongPress(900, 11)).toBe(false);
  });
});

describe('useLongPressSelectWord', () => {
  let editor: Editor;
  let root: Root;

  beforeEach(() => {
    vi.useFakeTimers();
    const element = document.createElement('div');
    document.body.appendChild(element);
    editor = new Editor({ element, extensions: createBaseExtensions(), content: '<p>quick brown fox</p>' });
    editor.commands.setTextSelection(3);
    // happy-dom does no layout: the press lands inside "brown" (doc position 9).
    vi.spyOn(editor.view, 'posAtCoords').mockReturnValue({ pos: 9, inside: -1 });
    const Probe = () => {
      useLongPressSelectWord(editor, true);
      return null;
    };
    root = createRoot(document.createElement('div'));
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    editor.destroy();
    vi.useRealTimers();
  });

  const touch = (type: string, x: number, y: number, timeStamp: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    const point = { clientX: x, clientY: y };
    Object.defineProperties(event, {
      touches: { value: type === 'touchend' || type === 'touchcancel' ? [] : [point] },
      timeStamp: { value: timeStamp },
    });
    editor.view.dom.dispatchEvent(event);
  };
  const selected = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to);
  };

  it('selects the word under a stationary long press, after iOS has put the caret down', () => {
    touch('touchstart', 100, 200, 0);
    touch('touchmove', 104, 203, 300);
    touch('touchend', 104, 203, 650);
    vi.runAllTimers();
    expect(selected()).toBe('brown');
  });

  it('leaves a short tap to the browser', () => {
    touch('touchstart', 100, 200, 0);
    touch('touchend', 100, 200, 120);
    vi.runAllTimers();
    expect(editor.state.selection.empty).toBe(true);
  });

  it('leaves a press that drags (the caret loupe) alone', () => {
    touch('touchstart', 100, 200, 0);
    touch('touchmove', 160, 200, 400);
    touch('touchend', 160, 200, 900);
    vi.runAllTimers();
    expect(editor.state.selection.empty).toBe(true);
  });
});
