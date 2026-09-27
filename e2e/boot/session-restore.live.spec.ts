import { test, expect, waitForAppReady } from '../fixtures';

test('signed-in shell renders, survives a reload, and the token-verify request succeeds', async ({ liveRun }) => {
    const { page } = liveRun;

    await expect(page).not.toHaveURL(/\/welcome/);
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();

    const [verifyResponse] = await Promise.all([
        page.waitForResponse((res) => res.url().includes('/auth/verifytoken')),
        page.reload(),
    ]);
    expect(verifyResponse.status()).toBe(200);
    await waitForAppReady(page);

    await expect(page).not.toHaveURL(/\/welcome/);
    await expect(page.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
});
