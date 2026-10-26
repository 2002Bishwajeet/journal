// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act, createElement } from 'react';
import type { PendingSyncItem } from '@/lib/db/queries/diagnostics';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { navigate, close, retryAll, retryItem, copyReport, markShareDriveFixAttempted, diagnostics } = vi.hoisted(() => ({
    navigate: vi.fn(),
    close: vi.fn(),
    retryAll: vi.fn(async () => {}),
    retryItem: vi.fn(async () => {}),
    copyReport: vi.fn(async () => {}),
    markShareDriveFixAttempted: vi.fn(),
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
        shareDriveFixUrl: null,
        shareDriveFixes: [],
        driveOwnerFix: false,
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

    const NOTICE = '[data-testid="share-notifications-off"]';
    const FIX = {
        shareDriveFixUrl: 'https://me.id/owner/appupdate?appId=x',
        driveSettingsUrl: 'https://me.id/owner/drives/alias_type',
        markShareDriveFixAttempted,
        shareDriveFixFailed: false,
    };

    it('offers one primary Fix in owner console button, with the manual steps collapsed (#870)', async () => {
        setDiagnostics([], { ...FIX, shareDriveFixes: ['subscriptions', 'attribute'] });
        await render();

        const panel = document.querySelector(NOTICE);
        expect(panel?.textContent).toContain('Share notifications are off');
        const fix = [...(panel?.querySelectorAll('a') ?? [])].find((a) => a.textContent?.trim() === 'Fix in owner console');
        expect(fix?.getAttribute('href')).toBe('https://me.id/owner/appupdate?appId=x');
        expect(fix?.getAttribute('target')).toBeNull();
        expect(panel?.querySelectorAll('details')).toHaveLength(1);
        expect(panel?.querySelector('details')?.hasAttribute('open')).toBe(false);
        expect(panel?.querySelector('summary')?.textContent).toBe('Do it by hand');

        await act(async () => { fix?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
        expect(markShareDriveFixAttempted).toHaveBeenCalledTimes(1);
    });

    it('keeps the manual steps and the drive link inside the toggle', async () => {
        setDiagnostics([], { ...FIX, shareDriveFixes: ['subscriptions', 'attribute'] });
        await render();

        const details = document.querySelector(`${NOTICE} details`);
        const steps = [...(details?.querySelectorAll('ol > li') ?? [])].map((li) => li.textContent);
        expect(steps).toEqual([
            'Turn on "Allow subscriptions".',
            'Add the attribute IsCollaborativeChannel with the value true.',
        ]);
        const link = details?.querySelector('a');
        expect(link?.getAttribute('href')).toBe('https://me.id/owner/drives/alias_type');
        expect(link?.getAttribute('target')).toBe('_blank');
        expect(document.querySelector(`${NOTICE} [role="status"]`)).toBeNull();
    });

    it('lists subscriptions last as a maybe when only the refusal points at it', async () => {
        setDiagnostics([], { ...FIX, shareDriveFixes: ['attribute', 'maybeSubscriptions'] });
        await render();

        const steps = [...document.querySelectorAll(`${NOTICE} li`)].map((li) => li.textContent);
        expect(steps).toEqual([
            'Add the attribute IsCollaborativeChannel with the value true.',
            'If shares still don\'t notify people after this, also turn on "Allow subscriptions".',
        ]);
    });

    it('opens the manual steps and says the owner console may need an update when the fix did not take', async () => {
        setDiagnostics([], { ...FIX, shareDriveFixes: ['attribute'], shareDriveFixFailed: true });
        await render();

        expect(document.querySelector(`${NOTICE} details`)?.hasAttribute('open')).toBe(true);
        expect(document.querySelector(`${NOTICE} [role="status"]`)?.textContent).toContain('may need an update');
    });

    it('shows the owner step in its own notice, not under share notifications (#870)', async () => {
        setDiagnostics([], { driveSettingsUrl: 'https://me.id/owner/drives/alias_type', driveOwnerFix: true });
        await render();

        expect(document.querySelector(NOTICE)).toBeNull();
        const panel = document.querySelector('[data-testid="drive-owner"]');
        expect(panel?.textContent).toContain("Journal doesn't own its drive");
        expect(panel?.textContent).toContain('does not stop share notifications');
        expect([...(panel?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
            'Choose "Assign to an app", pick Journal and keep the drive slug journal-notes. The drive keeps its id and your notes.',
        ]);
        expect(panel?.querySelector('a')?.getAttribute('href')).toBe('https://me.id/owner/drives/alias_type');
    });

    it('shows no share notification notice by default', async () => {
        setDiagnostics([]);
        await render();
        expect(document.querySelector('[data-testid="share-notifications-off"]')).toBeNull();
        expect(document.querySelector('[data-testid="drive-owner"]')).toBeNull();
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
