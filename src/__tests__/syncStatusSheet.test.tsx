// @vitest-environment happy-dom
/** #828: on touch layouts the sync status opens a bottom sheet, on desktop the popover. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { createElement, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const sync = vi.fn();
const openSettings = vi.fn();

vi.mock('@/hooks', () => ({
  useSyncService: () => ({
    syncStatus: 'idle',
    pendingCount: { total: 3, failed: 0 },
    syncProgress: null,
    lastSyncedAt: null,
    sync,
  }),
}));
vi.mock('@/hooks/useOnlineContext', () => ({ useOnlineContext: () => ({ isOnline: true }) }));
vi.mock('@/hooks/useSettingsOpener', () => ({ openSettings: (tab: string) => openSettings(tab) }));

import { SyncStatus } from '@/components/layout/SyncStatus';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;

async function mount(touch: boolean) {
  vi.stubGlobal('matchMedia', () => ({ matches: touch, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  root = createRoot(document.body.appendChild(document.createElement('div')));
  await act(async () => root.render(createElement(SyncStatus)));
  await act(async () => document.querySelector<HTMLElement>('button[aria-label="Sync status"]')!.click());
}

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const byText = (text: string) =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.includes(text));

describe('SyncStatus', () => {
  it('opens a bottom sheet on a touch layout, with a full-width Sync now and a Diagnostics row', async () => {
    await mount(true);
    expect(document.querySelector('[role="dialog"]')?.getAttribute('data-variant')).toBe('bottom');
    expect(document.body.textContent).toContain('3 changes waiting');
    expect(byText('Sync now')?.className).toMatch(/h-11/);

    await act(async () => byText('Open diagnostics')!.click());
    await vi.waitFor(() => expect(openSettings).toHaveBeenCalledWith('diagnostics'));
  });

  it('opens the popover on desktop', async () => {
    await mount(false);
    expect(document.querySelector('[data-slot="sheet-header"]')).toBeNull();
    expect(byText('Open diagnostics')).toBeUndefined();
    expect(byText('Pending items')).toBeDefined();
  });
});
