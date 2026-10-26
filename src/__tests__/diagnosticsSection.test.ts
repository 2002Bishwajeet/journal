// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';
import type { PendingSyncItem } from '@/lib/db/queries/diagnostics';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { navigate, close, retryAll, retryItem, copyReport, diagnostics } = vi.hoisted(() => ({
    navigate: vi.fn(),
    close: vi.fn(),
    retryAll: vi.fn(async () => {}),
    retryItem: vi.fn(async () => {}),
    copyReport: vi.fn(async () => {}),
    diagnostics: { current: {} as Record<string, unknown> },
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }));
vi.mock('@/hooks/useDiagnostics', () => ({ useDiagnostics: () => diagnostics.current }));

import DiagnosticsSection from '@/components/settings/sections/DiagnosticsSection';

const item = (overrides: Partial<PendingSyncItem>): PendingSyncItem => ({
    id: 'id-1',
    kind: 'note',
    status: 'pending',
    isDelete: false,
    title: 'Groceries',
    noteId: 'id-1',
    folderId: 'folder-1',
    contentType: null,
    lastSyncedAt: null,
    retryCount: 0,
    nextRetryAt: null,
    error: null,
    ...overrides,
});

function setDiagnostics(items: PendingSyncItem[] | null, extra: Record<string, unknown> = {}) {
    diagnostics.current = {
        status: [{ label: 'Identity', value: 'frodo.dotyou.cloud' }],
        items,
        log: [
            { at: 1, level: 'info', message: 'sync started' },
            { at: 2, level: 'error', message: 'push exploded' },
        ],
        isSyncing: false,
        isOnline: true,
        retrying: null,
        retryAll,
        retryItem,
        includeTitles: false,
        setIncludeTitles: vi.fn(),
        copyReport,
        canShare: false,
        shareReport: vi.fn(),
        shareNotificationsFixUrl: null,
        ...extra,
    };
}

function buttonByText(text: string) {
    return [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
}

describe('DiagnosticsSection', () => {
    let host: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
        vi.clearAllMocks();
        host = document.createElement('div');
        document.body.appendChild(host);
        root = createRoot(host);
    });

    afterEach(async () => {
        await act(async () => { root.unmount(); });
        host.remove();
    });

    const render = () => act(async () => { root.render(createElement(DiagnosticsSection, { close })); });

    it('shows each pending item with its plain-words error and raw code', async () => {
        setDiagnostics([
            item({}),
            item({
                id: 'id-2',
                status: 'retrying',
                retryCount: 3,
                nextRetryAt: new Date(Date.now() + 120_000).toISOString(),
                title: null,
                noteId: null,
                error: { message: 'Request failed with status code 403', code: null, operation: 'push', since: new Date().toISOString() },
            }),
        ]);
        await render();

        const rows = document.querySelectorAll('[data-testid="pending-item"]');
        expect(rows).toHaveLength(2);
        expect(rows[0].textContent).toContain('Groceries');
        expect(rows[0].textContent).toContain('Pending');
        expect(rows[1].textContent).toContain('Untitled');
        expect(rows[1].textContent).toContain('Retrying');
        expect(rows[1].textContent).toContain('3 retries');
        expect(rows[1].textContent).toContain("doesn't have permission");
        expect(rows[1].textContent).toContain('HTTP 403 · Request failed with status code 403');
    });

    it('opens a note on tap and closes Settings', async () => {
        setDiagnostics([item({})]);
        await render();

        await act(async () => { document.querySelector<HTMLButtonElement>('button[aria-label="Groceries"]')?.click(); });
        expect(navigate).toHaveBeenCalledWith('/folder-1/id-1');
        expect(close).toHaveBeenCalled();
    });

    it('retries one item or the whole queue', async () => {
        const row = item({});
        setDiagnostics([row]);
        await render();

        await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="Retry Groceries"]')?.click(); });
        expect(retryItem).toHaveBeenCalledWith(row);

        const retryNow = [...document.querySelectorAll('button')].filter((b) => b.textContent?.trim() === 'Retry now').at(-1);
        await act(async () => { retryNow?.click(); });
        expect(retryAll).toHaveBeenCalledTimes(1);
    });

    it('cannot retry while offline', async () => {
        setDiagnostics([item({})], { isOnline: false });
        await render();
        expect(document.querySelector<HTMLButtonElement>('[aria-label="Retry Groceries"]')?.disabled).toBe(true);
    });

    it('offers the owner console link when share notifications are off (#817)', async () => {
        setDiagnostics([], { shareNotificationsFixUrl: 'https://me.id/owner/drives/alias_type' });
        await render();

        const panel = document.querySelector('[data-testid="share-notifications-off"]');
        expect(panel?.textContent).toContain('Share notifications are off');
        expect(panel?.textContent).toContain('Allow subscriptions');
        const link = panel?.querySelector('a');
        expect(link?.getAttribute('href')).toBe('https://me.id/owner/drives/alias_type');
        expect(link?.getAttribute('target')).toBe('_blank');
    });

    it('shows no share notification notice by default', async () => {
        setDiagnostics([]);
        await render();
        expect(document.querySelector('[data-testid="share-notifications-off"]')).toBeNull();
    });

    it('says when nothing is waiting', async () => {
        setDiagnostics([]);
        await render();
        expect(host.textContent).toContain('Nothing is waiting to sync.');
    });

    it('filters the log to errors and warnings', async () => {
        setDiagnostics([]);
        await render();
        expect(host.textContent).toContain('sync started');

        await act(async () => { document.querySelector<HTMLButtonElement>('[role="switch"]')?.click(); });
        expect(host.textContent).not.toContain('sync started');
        expect(host.textContent).toContain('push exploded');
    });

    it('copies the report, and offers Share only when the device can', async () => {
        setDiagnostics([]);
        await render();
        await act(async () => { buttonByText('Copy diagnostics')?.click(); });
        expect(copyReport).toHaveBeenCalled();
        expect(buttonByText('Share')).toBeUndefined();

        setDiagnostics([], { canShare: true });
        await render();
        expect(buttonByText('Share')).toBeDefined();
    });
});
