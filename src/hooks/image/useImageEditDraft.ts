import { useRef, useState } from 'react';
import {
  NO_EDITS,
  centeredCrop,
  dragCorner,
  fromDisplayCrop,
  moveCrop,
  rotateEdits,
  toDisplayCrop,
  type Corner,
  type ImageCrop,
  type ImageEdits,
} from '@/lib/images/imageEdits';

/** A crop ratio preset: null is free, 'original' the image's own shape as shown. */
export type CropRatio = number | 'original' | null;

const ARROWS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * The edit dialog's draft (#584). The crop is kept as a crop of the original, so
 * rotating or flipping carries it along; the dialog draws and drags it over the
 * image as shown (`rect`, fractions of the `areaRef` box).
 */
export function useImageEditDraft(initial: ImageEdits) {
  const [draft, setDraft] = useState(initial);
  const [ratio, setRatio] = useState<CropRatio>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const rect = toDisplayCrop(draft);

  // Pixel w/h of the image as shown, which the ratio presets are relative to.
  const aspect = () => {
    const box = areaRef.current?.getBoundingClientRect();
    return box?.height ? box.width / box.height : 1;
  };
  const lock = () => (ratio === 'original' ? aspect() : ratio);
  const setRect = (next: ImageCrop) => setDraft((d) => ({ ...d, crop: fromDisplayCrop(next, d) }));
  const cornerAt = (corner: Corner): [number, number] => [
    corner[1] === 'w' ? rect.x : rect.x + rect.w,
    corner[0] === 'n' ? rect.y : rect.y + rect.h,
  ];

  const pickRatio = (next: CropRatio) => {
    setRatio(next);
    if (next !== null) setRect(centeredCrop(next === 'original' ? aspect() : next, aspect()));
  };

  /** Pointer down on the crop (corner null: move it) or on one of its corners. */
  const startDrag = (corner: Corner | null) => (e: React.PointerEvent<HTMLElement>) => {
    const area = areaRef.current?.getBoundingClientRect();
    if (!area) return;
    e.preventDefault();
    e.stopPropagation();
    const target = e.currentTarget;
    const start = rect;
    const [sx, sy] = [e.clientX, e.clientY];
    const locked = lock();
    target.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      setRect(
        corner
          ? dragCorner(start, corner, (ev.clientX - area.left) / area.width, (ev.clientY - area.top) / area.height, locked, area.width / area.height)
          : moveCrop(start, (ev.clientX - sx) / area.width, (ev.clientY - sy) / area.height),
      );
    };
    const onEnd = () => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onEnd);
      target.removeEventListener('pointercancel', onEnd);
    };
    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onEnd);
    target.addEventListener('pointercancel', onEnd);
  };

  /** Arrow keys move the crop (corner null) or one corner: 1% a press, 10% with Shift. */
  const onKeyDown = (corner: Corner | null) => (e: React.KeyboardEvent) => {
    const arrow = ARROWS[e.key];
    if (!arrow) return;
    e.preventDefault();
    e.stopPropagation();
    const step = e.shiftKey ? 0.1 : 0.01;
    const [dx, dy] = [arrow[0] * step, arrow[1] * step];
    if (!corner) return setRect(moveCrop(rect, dx, dy));
    const [x, y] = cornerAt(corner);
    setRect(dragCorner(rect, corner, x + dx, y + dy, lock(), aspect()));
  };

  return {
    draft,
    ratio,
    rect,
    areaRef,
    pickRatio,
    startDrag,
    onKeyDown,
    rotate: (dir: 1 | -1) => setDraft((d) => rotateEdits(d, dir)),
    flip: (axis: 'flipH' | 'flipV') => setDraft((d) => ({ ...d, [axis]: !d[axis] })),
    reset: () => {
      setDraft(NO_EDITS);
      setRatio(null);
    },
  };
}
