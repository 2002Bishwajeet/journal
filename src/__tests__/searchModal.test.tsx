// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SearchModal from '@/components/modals/SearchModal';

const handleClose = vi.fn();
const setSelectedIndex = vi.fn();
const handleRemoveEntry = vi.fn();
const handleClearRecents = vi.fn();
const handleRemoveChip = vi.fn();
const handleFilterButton = vi.fn();
// Rows a test puts above the default ones.
let extraEntries: unknown[] = [];

vi.mock('@/hooks/useSearchModal', () => ({
  isAdvancedResult: () => false,
  useSearchModal: () => ({
    query: 'ze',
    entries: [
      ...extraEntries,
      { kind: 'note', section: 'recent', result: { docId: 'a', title: 'Alpha', metadata: { folderId: 'main', tags: ['x', 'y', 'z', 'w'], timestamps: { modified: new Date().toISOString() } } } },
      { kind: 'note', section: 'notes', result: { docId: 'b', title: 'Beta', preview: '', metadata: { folderId: 'gone' } } },
      { kind: 'note', section: 'notes', result: { docId: 'c', title: 'Zebra', metadata: { folderId: 'fc360190-4e23-b870-0ea4-ef233aad98ad' } } },
    ],
    selectedIndex: 0,
    isLoading: false,
    status: '3 results',
    handleDialogKeyDown: vi.fn(),
    folderNames: new Map([['main', 'Main']]),
    searchText: 'ze',
    chips: [{ label: '#recipe', token: { kind: 'tag', value: 'recipe', start: 3, end: 13 } }],
    inputRef: { current: null },
    handleQueryChange: vi.fn(),
    handleCaretChange: vi.fn(),
    handleRemoveChip,
    handleFilterButton,
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
    [...document.querySelectorAll('button')].find((b) => b.textContent?.includes(text))!;

  it('is a labelled modal dialog', () => {
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.getAttribute('aria-label')).toBe('Search notes');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('Remove and Clear act without taking focus from the input, and are 44px on touch', () => {
    const input = document.querySelector('input')!;
    const remove = document.querySelector<HTMLButtonElement>('[aria-label="Remove Alpha from recent"]')!;
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
    const rows = document.querySelectorAll('[id^="search-result-"]');
    expect(rows[0].textContent).toMatch(/Main · .+ · #x #y #z/);
    expect(rows[0].textContent).not.toContain('#w');
    expect(rows[1].textContent).toBe('Beta');
    expect(rows[2].textContent).toContain('Shared');
  });

  it('marks the typed part of the title and never says "No preview available"', () => {
    const marks = [...document.querySelectorAll('mark')].map((m) => m.textContent);
    expect(marks).toEqual(['Ze']);
    expect(document.body.textContent).not.toContain('No preview available');
  });

  it('is a combobox over a listbox of grouped options, with the selected one as the active descendant', () => {
    const input = document.querySelector('input')!;
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-label')).toBe('Search notes');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-autocomplete')).toBe('list');
    expect(input.getAttribute('enterkeyhint')).toBe('search');
    const listbox = document.querySelector('[role="listbox"]')!;
    expect(input.getAttribute('aria-controls')).toBe(listbox.id);
    const options = [...document.querySelectorAll('[role="option"]')];
    expect(options.map((o) => o.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(document.getElementById(input.getAttribute('aria-activedescendant')!)).toBe(options[0]);
    const groups = [...listbox.querySelectorAll('[role="group"]')];
    expect(groups.map((g) => document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Recent', 'Notes']);
  });

  it('keeps Remove and Clear out of the options', () => {
    for (const b of document.querySelectorAll('button')) expect(b.closest('[role="option"]')).toBeNull();
  });

  it('lists filter suggestions as options in their own group, with no Remove button (#1230)', () => {
    extraEntries = [{ kind: 'filter', section: 'filters', key: 'tag', label: '#recipe', count: 2, token: 'tag:recipe' }];
    try {
      renderAt(390, true);
      const option = document.getElementById('search-result-0')!;
      expect(option.getAttribute('role')).toBe('option');
      expect(option.getAttribute('aria-selected')).toBe('true');
      expect(option.closest('[role="group"]')!.getAttribute('aria-labelledby')).toBe('search-section-filters');
      expect(document.querySelectorAll('[role="option"]')).toHaveLength(4);
      expect(option.parentElement!.querySelector('button')).toBeNull();
    } finally {
      extraEntries = [];
    }
  });

  it('announces the status in a polite live region', () => {
    const status = document.querySelector('[role="status"]')!;
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('3 results');
  });

  it('shows the filters as chips and, on a phone, 44px filter buttons, which keep the input focused (#1230)', () => {
    const chip = document.querySelector<HTMLButtonElement>('[aria-label="Remove filter #recipe"]')!;
    const buttons = ['Folder', 'Tag', 'Date', 'Pinned'].map(button);
    for (const b of [chip, ...buttons]) {
      const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
      b.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      expect(b.className).toMatch(/(pointer-coarse:)?h-11/);
    }
    expect(buttons[3].getAttribute('aria-pressed')).toBe('false');
    act(() => chip.click());
    expect(handleRemoveChip).toHaveBeenCalledWith(expect.objectContaining({ label: '#recipe' }));
    act(() => buttons[1].click());
    expect(handleFilterButton).toHaveBeenCalledWith('tag');

    // The palette (a mouse) has the chips but not the buttons.
    renderAt(1280, false);
    expect(document.querySelector('[aria-label="Remove filter #recipe"]')).not.toBeNull();
    expect(button('Pinned')).toBeUndefined();
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
    expect(document.querySelector('kbd')).toBeNull();
    expect(document.body.textContent).not.toContain('navigate');

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
    expect([...document.querySelectorAll('kbd')].map((k) => k.textContent)).toContain('Esc');
    expect(document.body.textContent).toContain('navigate');
    renderAt(640, false);
    expect(isPalette()).toBe(true);

    // Below 640 px even a mouse gets the full-screen search.
    renderAt(639, false);
    expect(isPalette()).toBe(false);
  });

  it('hover selects a result for a mouse but not for touch', () => {
    const beta = document.querySelector<HTMLElement>('#search-result-1')!;
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
    const sheet = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const vars = () => [sheet.style.getPropertyValue('--dialog-top'), sheet.style.getPropertyValue('--dialog-max-h')];
    expect(vars()).toEqual(['', '']);

    Object.assign(vv, { height: 420, offsetTop: 0 });
    vv.dispatchEvent(new Event('resize'));
    expect(vars()).toEqual(['210px', '420px']);
    delete (window as { visualViewport?: unknown }).visualViewport;
    delete (window as { innerHeight?: unknown }).innerHeight;
  });
});
