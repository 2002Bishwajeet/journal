// @vitest-environment happy-dom
/**
 * #1362: the desktop app's reset screens. The local data is deleted only by the user's
 * click, never on its own, and the leftover prompt counts the changes a reset loses.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createElement as h, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { resetLocalData, leftover } = vi.hoisted(() => ({
    resetLocalData: vi.fn(async () => {}),
    leftover: { open: true, unsynced: 1, dismiss: () => {}, reset: async () => {} },
}));
vi.mock('@/lib/db/localReset', () => ({ resetLocalData }));
vi.mock('@/hooks/useLeftoverReset', () => ({ useLeftoverReset: () => leftover }));

import { BootErrorScreen } from '@/components/layout/SplashScreen';
import LeftoverResetDialog from '@/components/modals/LeftoverResetDialog';
import { reportBootError, clearBootError } from '@/lib/bootProgress';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function render(element: ReturnType<typeof h>) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root.render(element));
}

function bootError(name: string): Error {
    const error = new Error('cannot open');
    error.name = name;
    return error;
}

const resetButton = () =>
    [...document.querySelectorAll('button')].find((b) => b.textContent === 'Reset local data and sync again');

beforeEach(() => {
    resetLocalData.mockClear();
    vi.spyOn(window.location, 'reload').mockImplementation(() => {});
});

afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    clearBootError();
    vi.restoreAllMocks();
});

describe('BootErrorScreen reset', () => {
    it.each([
        ['DatabaseKeyMissingError', 'The key to them is missing from the system keychain.'],
        ['CorruptStoreError', 'The local copy is damaged.'],
    ])('offers the reset for %s and resets only on the click', async (name, reason) => {
        reportBootError(bootError(name));
        await render(h(BootErrorScreen));

        expect(document.body.textContent).toContain(reason);
        const button = resetButton();
        expect(button).toBeDefined();
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
        });
        expect(resetLocalData).not.toHaveBeenCalled();

        await act(async () => button!.click());
        await vi.waitFor(() => expect(resetLocalData).toHaveBeenCalledTimes(1));
        await vi.waitFor(() => expect(window.location.reload).toHaveBeenCalled());
    });

    it('offers no reset for other boot errors', async () => {
        reportBootError(bootError('LegacyMigrationError'));
        await render(h(BootErrorScreen));

        expect(resetButton()).toBeUndefined();
        expect(resetLocalData).not.toHaveBeenCalled();
    });
});

describe('LeftoverResetDialog', () => {
    it.each([
        [1, '1 change on this device couldn\'t sync. A reset deletes it', 'Not now keeps it,'],
        [3, '3 changes on this device couldn\'t sync. A reset deletes them', 'Not now keeps them,'],
    ])('words the count for %i unsynced', async (unsynced, count, keep) => {
        leftover.unsynced = unsynced;
        await render(h(LeftoverResetDialog));

        expect(document.body.textContent).toContain(count);
        expect(document.body.textContent).toContain(keep);
    });
});
