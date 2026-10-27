import type { Instance, Props } from 'tippy.js';

// One listener re-measures every open suggestion popup when the on-screen
// keyboard moves the visual viewport. tippy re-measures only on its own updates (#790).
const open = new Set<Instance>();

const update = () => open.forEach((popup) => popup.popperInstance?.update());

/** Spread into the tippy options of a suggestion popup. */
export const viewportResizeProps: Partial<Props> = {
  onCreate: (popup) => {
    if (!open.size) window.visualViewport?.addEventListener('resize', update);
    open.add(popup);
  },
  onDestroy: (popup) => {
    open.delete(popup);
    if (!open.size) window.visualViewport?.removeEventListener('resize', update);
  },
};
