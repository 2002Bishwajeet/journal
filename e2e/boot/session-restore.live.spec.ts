import { test, expect, waitForAppReady } from '../fixtures';

test('signed-in shell renders and survives a reload', async ({ liveRun }) => {
    const { page } = liveRun;

    await expect(page).not.toHaveURL(/\/welcome/);
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();

    // No page.waitForResponse('/auth/verifytoken') here: useVerifyToken sets
    // staleTime: Infinity + refetchOnMount: false, and App.tsx persists the
    // whole query cache to IndexedDB (PersistQueryClientProvider), so a
    // reload deliberately rehydrates the prior verify result instead of
    // re-querying the network — confirmed on a live identity (#203), where
    // the old assertion here just hung for the full test timeout waiting on
    // a request that never fires.
    await page.reload();
    await waitForAppReady(page);

    await expect(page).not.toHaveURL(/\/welcome/);
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
});
