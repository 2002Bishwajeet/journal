// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SearchModal from '@/components/modals/SearchModal';

const handleClose = vi.fn();
const setSelectedIndex = vi.fn();

vi.mock('@/hooks/useSearchModal', () => ({
  isAdvancedResult: () => false,
  useSearchModal: () => ({
    query: 'ze',
    results: [
      { docId: 'a', title: 'Alpha' },
      { docId: 'b', title: 'Beta' },
    ],
    selectedIndex: 0,
    isLoading: false,
    inputRef: { current: null },
    handleQueryChange: vi.fn(),
    handleKeyDown: vi.fn(),
    handleClose,
    handleSelectResult: vi.fn(),
    setSelectedIndex,
  }),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SearchModal', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    handleClose.mockClear();
    setSelectedIndex.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root.render(createElement(SearchModal, { isOpen: true, onClose: () => {}, onSelectNote: () => {} }));
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

  it('is a labelled modal dialog', () => {
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Search notes');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('Cancel closes the modal', () => {
    act(() => button('Cancel').click());
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  it('hover selects a result for a mouse but not for touch', () => {
    const beta = button('Beta');
    const enter = (pointerType: string) =>
      act(() => {
        const e = new Event('pointerover', { bubbles: true });
        Object.assign(e, { pointerType });
        beta.dispatchEvent(e);
      });
    enter('touch');
    expect(setSelectedIndex).not.toHaveBeenCalled();
    enter('mouse');
    expect(setSelectedIndex).toHaveBeenCalledWith(1);
  });

  it('fills only the part of the screen above the keyboard', () => {
    // Defined on window itself, so deleting it below brings back happy-dom's own.
    const vv = Object.assign(new EventTarget(), { height: 852, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 852, configurable: true });
    const render = (isOpen: boolean) =>
      act(() => root.render(createElement(SearchModal, { isOpen, onClose: () => {}, onSelectNote: () => {} })));
    // Reopen, so the sheet mounts with the viewport above.
    render(false);
    render(true);
    const sheet = host.querySelector<HTMLElement>('[role="dialog"]')!;
    const vars = () => [sheet.style.getPropertyValue('--dialog-top'), sheet.style.getPropertyValue('--dialog-max-h')];
    expect(vars()).toEqual(['', '']);

    Object.assign(vv, { height: 420, offsetTop: 0 });
    vv.dispatchEvent(new Event('resize'));
    expect(vars()).toEqual(['210px', '420px']);
    delete (window as { visualViewport?: unknown }).visualViewport;
    delete (window as { innerHeight?: unknown }).innerHeight;
  });
});
