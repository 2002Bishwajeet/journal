// @vitest-environment happy-dom
/**
 * The edit dialog's draft (#584): a quarter turn turns the crop with the picture,
 * so a locked ratio preset no longer holds and is cleared; a flip keeps the
 * crop's shape and so keeps the preset.
 */
import { describe, it, expect } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot } from 'react-dom/client';
import { useImageEditDraft } from '@/hooks/image/useImageEditDraft';
import { NO_EDITS } from '@/lib/images/imageEdits';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountDraft() {
  const result: { current: ReturnType<typeof useImageEditDraft> } = { current: null! };
  function Probe() {
    result.current = useImageEditDraft(NO_EDITS);
    return null;
  }
  act(() => createRoot(document.createElement('div')).render(h(Probe)));
  return result;
}

describe('useImageEditDraft ratio preset', () => {
  it('clears a locked ratio on rotate', () => {
    const draft = mountDraft();
    act(() => draft.current.pickRatio(16 / 9));
    expect(draft.current.ratio).toBe(16 / 9);
    act(() => draft.current.rotate(1));
    expect(draft.current.ratio).toBeNull();
    expect(draft.current.draft.rotate).toBe(90);
  });

  it('keeps a locked ratio on flip', () => {
    const draft = mountDraft();
    act(() => draft.current.pickRatio(16 / 9));
    act(() => draft.current.flip('flipH'));
    expect(draft.current.ratio).toBe(16 / 9);
    expect(draft.current.draft.flipH).toBe(true);
  });
});
