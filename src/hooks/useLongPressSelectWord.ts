import { useEffect } from "react";
import type { Editor } from "@tiptap/react";
import { getWordAt, isLongPress } from "@/lib/editor/mobileBar";

/**
 * A stationary long press on a word selects it, which brings up the format bar, like Apple
 * Notes (#1272). iOS only puts the caret there (its loupe); a press that moves is a caret
 * drag and is left to the loupe, and taps (double-tap selects a word) are untouched.
 * Touch only: listens to touch events, so a mouse or pen never triggers it.
 */
export function useLongPressSelectWord(editor: Editor, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const dom = editor.view.dom;
    let press: { x: number; y: number; time: number; far: number } | null = null;
    let timer = 0;

    const onStart = (e: TouchEvent) => {
      const touch = e.touches.length === 1 ? e.touches[0] : null;
      press = touch && { x: touch.clientX, y: touch.clientY, time: e.timeStamp, far: 0 };
    };
    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0];
      if (press && touch) press.far = Math.max(press.far, Math.hypot(touch.clientX - press.x, touch.clientY - press.y));
    };
    const onEnd = (e: TouchEvent) => {
      const done = press;
      press = null;
      if (!done || !isLongPress(e.timeStamp - done.time, done.far)) return;
      // iOS puts the caret down as the finger lifts: select the word once it has.
      clearTimeout(timer);
      timer = window.setTimeout(() => selectWordAt(editor, done.x, done.y), 0);
    };

    dom.addEventListener("touchstart", onStart, { passive: true });
    dom.addEventListener("touchmove", onMove, { passive: true });
    dom.addEventListener("touchend", onEnd);
    dom.addEventListener("touchcancel", onEnd);
    return () => {
      clearTimeout(timer);
      dom.removeEventListener("touchstart", onStart);
      dom.removeEventListener("touchmove", onMove);
      dom.removeEventListener("touchend", onEnd);
      dom.removeEventListener("touchcancel", onEnd);
    };
  }, [editor, enabled]);
}

function selectWordAt(editor: Editor, x: number, y: number) {
  if (editor.isDestroyed) return;
  const hit = editor.view.posAtCoords({ left: x, top: y });
  if (!hit) return;
  const $pos = editor.state.doc.resolve(hit.pos);
  if (!$pos.parent.isTextblock || $pos.parent.type.spec.code) return;
  // Inline nodes (a hard break, a mention) count as one character, as they do in positions.
  const text = $pos.parent.textBetween(0, $pos.parent.content.size, undefined, "￼");
  const word = getWordAt(text, $pos.parentOffset);
  if (!word) return;
  const start = $pos.start();
  editor.chain().focus(undefined, { scrollIntoView: false }).setTextSelection({ from: start + word[0], to: start + word[1] }).run();
}
