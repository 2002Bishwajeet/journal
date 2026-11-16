// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SearchModal from '@/components/modals/SearchModal';

const handleClose = vi.fn();
const setSelectedIndex = vi.fn();
const handleRemoveEntry = vi.fn();
const handleClearRecents = vi.fn();

vi.mock('@/hooks/useSearchModal', () => ({
  isAdvancedResult: () => false,
  useSearchModal: () => ({
    query: 'ze',
    entries: [
      { kind: 'note', section: 'recent', result: { docId: 'a', title: 'Alpha', metadata: { folderId: 'main', tags: ['x', 'y', 'z', 'w'], timestamps: { modified: new Date().toISOString() } } } },
      { kind: 'note', section: 'notes', result: { docId: 'b', title: 'Beta', preview: '', metadata: { folderId: 'gone' } } },
      { kind: 'note', section: 'notes', result: { docId: 'c', title: 'Zebra', metadata: { folderId: 'fc360190-4e23-b870-0ea4-ef233aad98ad' } } },
    ],
    selectedIndex: 0,
    isLoading: false,
    folderNames: new Map([['main', 'Main']]),
    inputRef: { current: null },
    handleQueryChange: vi.fn(),
    handleKeyDown: vi.fn(),
    handleClose,
    handleSelectEntry: vi.fn(),
    handleRemoveEntry,
    handleClearRecents,
    setSelectedIndex,
  }),
}));

// The sheet's history entry (#822) needs a Router; useOverlayHistory.test.ts covers it.
vi.mock('@/hooks/useOverlayHistory', () => ({ useOverlayHistory: () => {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SearchModal', () => {
  let host: HTMLDivElement;
  let root: Root;
  // The simulated screen the media queries are evaluated against; a phone unless a test says otherwise.
  let screen = { width: 390, coarse: true };
  const matches = (query: string) =>
    query.split(', ').some((clause) =>
      clause.split(' and ').every((cond) => {
        const maxWidth = /\(max-width: (\d+)px\)/.exec(cond);
        if (maxWidth) return screen.width <= Number(maxWidth[1]);
        return cond === '(pointer: coarse)' ? screen.coarse : false;
      }),
    );

  const render = () =>
    act(() => {
      root.render(createElement(SearchModal, { isOpen: true, onClose: () => {}, onSelectNote: () => {} }));
    });

  beforeEach(() => {
    screen = { width: 390, coarse: true };
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: matches(query), addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    handleClose.mockClear();
    setSelectedIndex.mockClear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    render();
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  const button = (text: string) =>
    [...host.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

  it('is a labelled modal dialog', () => {
    const dialog = host.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Search notes');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('Remove and Clear act without taking focus from the input, and are 44px on touch', () => {
    const input = host.querySelector('input')!;
    const remove = host.querySelector<HTMLButtonElement>('[aria-label="Remove from recent"]')!;
    for (const b of [remove, button('Clear')]) {
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      b.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      expect(b.className).toMatch(/pointer-coarse:(size|h)-11/);
    }
    act(() => remove.click());
    expect(handleRemoveEntry).toHaveBeenCalledTimes(1);

    // A keyboard press focuses the button, which then unmounts; focus goes back to the input.
    button('Clear').focus();
    act(() => button('Clear').click());
    expect(handleClearRecents).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(input);
  });

  it('shows folder, date and up to 3 tags under the title, "Shared" for the collaborative folder', () => {
    const rows = host.querySelectorAll('[id^="search-result-"]');
    expect(rows[0].textContent).toMatch(/Main · .+ · #x #y #z/);
    expect(rows[0].textContent).not.toContain('#w');
    expect(rows[1].textContent).toBe('Beta');
    expect(rows[2].textContent).toContain('Shared');
  });

  it('marks the typed part of the title and never says "No preview available"', () => {
    const marks = [...host.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marks).toEqual(['Ze']);
    expect(host.textContent).not.toContain('No preview available');
  });

  it('Cancel closes the modal', () => {
    act(() => button('Cancel').click());
    expect(handleClose).toHaveBeenCalledTimes(1);
  });

  const renderAt = (width: number, coarse: boolean) => {
    act(() => root.unmount());
    root = createRoot(host);
    screen = { width, coarse };
    render();
  };
  const isPalette = () => button('Cancel') === undefined;

  it('is the full-screen search without keyboard hints on a touch screen, the palette for a mouse from 640 px (#1289)', () => {
    expect(host.querySelector('kbd')).toBeNull();
    expect(host.textContent).not.toContain('navigate');

    // iPhone Duo's inner display and a portrait iPad: touch below 1024 px gets the full-screen search.
    renderAt(669, true);
    expect(isPalette()).toBe(false);
    renderAt(820, true);
    expect(isPalette()).toBe(false);
    // An iPad in landscape is wide enough for the palette.
    renderAt(1180, true);
    expect(isPalette()).toBe(true);

    // A mouse keeps the palette from 640 px, as it had with the old sm: breakpoint.
    renderAt(700, false);
    expect(isPalette()).toBe(true);
    expect([...host.querySelectorAll('kbd')].map((k) => k.textContent)).toContain('Esc');
    expect(host.textContent).toContain('navigate');
    renderAt(640, false);
    expect(isPalette()).toBe(true);

    // Below 640 px even a mouse gets the full-screen search.
    renderAt(639, false);
    expect(isPalette()).toBe(false);
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
