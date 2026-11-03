// @vitest-environment happy-dom
/** #784: on a coarse pointer the long press opens the items in a bottom action sheet, not a pointer-anchored menu. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act } from 'react';
import type { ContextMenuItemConfig } from '@/components/ui/context-menu-wrapper';
import { createRoot } from 'react-dom/client';
import { Pin, Trash2 } from 'lucide-react';
import { ContextMenuWrapper } from '@/components/ui/context-menu-wrapper';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function stubPointer(coarse: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: coarse && query.includes('coarse'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

async function longPress(coarse: boolean) {
  stubPointer(coarse);
  const pin = vi.fn();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const items: ContextMenuItemConfig[] = [
    { label: 'Pin', icon: Pin, action: pin, shortcut: 'P' },
    { label: 'Move to Trash', icon: Trash2, action: vi.fn(), variant: 'destructive', shortcut: '⌫' },
  ];
  await act(async () => {
    root.render(
      createElement(
        ContextMenuWrapper,
        {
          items,
          children: createElement('div', { 'data-testid': 'row' }, 'row'),
        },
      ),
    );
  });
  const row = host.querySelector('[data-testid=row]')!;
  await act(async () => {
    row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 100 }));
  });
  return { pin, cleanup: async () => { await act(async () => root.unmount()); host.remove(); } };
}

afterEach(() => { document.body.innerHTML = ''; });

describe('ContextMenuWrapper', () => {
  it('opens an action sheet with the items and no shortcut hints on a coarse pointer', async () => {
    const { pin, cleanup } = await longPress(true);
    const menu = document.body.querySelector('[role=menu]')!;
    expect(menu).not.toBeNull();
    expect(menu.closest('[role=dialog]')).not.toBeNull();
    const items = [...menu.querySelectorAll('[role=menuitem]')].map((el) => el.textContent);
    expect(items).toEqual(['Pin', 'Move to Trash']);
    expect(menu.textContent).not.toContain('⌫');
    await act(async () => (menu.querySelector('[role=menuitem]') as HTMLElement).click());
    expect(pin).toHaveBeenCalledOnce();
    await cleanup();
  });

  it('keeps the pointer-anchored Radix menu on a fine pointer', async () => {
    const { cleanup } = await longPress(false);
    const menu = document.body.querySelector('[role=menu]')!;
    expect(menu).not.toBeNull();
    expect(menu.closest('[role=dialog]')).toBeNull();
    await cleanup();
  });
});
