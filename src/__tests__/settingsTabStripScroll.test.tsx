// @vitest-environment happy-dom
/**
 * The phone tab strip in Settings (#782): a parent re-render must not snap a
 * manually scrolled strip back to the active tab; reopening the dialog does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('@/hooks', () => ({ useDeviceType: () => 'mobile' }));
vi.mock('@/components/settings/sections', () => ({
  SETTINGS_SECTIONS: ['a', 'b', 'c', 'd'].map((id) => ({
    id,
    label: id.toUpperCase(),
    description: '',
    icon: () => null,
    Component: () => null,
  })),
}));

const { default: SettingsDialog } = await import('@/components/settings/SettingsDialog');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLElement;
let root: Root;
const scrollIntoView = vi.fn(function (this: Element) {
  // Emulate the browser snapping the strip back to the active tab.
  (this.closest('[role=tablist]') as HTMLElement).scrollLeft = 0;
});

const render = (isOpen: boolean) => act(async () => root.render(<SettingsDialog isOpen={isOpen} onClose={() => {}} />));
const tablist = () => document.querySelector('[role=tablist]') as HTMLElement;

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
  scrollIntoView.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe('Settings tab strip scroll', () => {
  it('keeps a manual scroll across a re-render that does not change the section', async () => {
    await render(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    tablist().scrollLeft = 120;
    await render(true);
    await render(true);

    expect(tablist().scrollLeft).toBe(120);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });

  it('scrolls the active tab into view again when the dialog reopens', async () => {
    await render(true);
    await render(false);
    await render(true);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
