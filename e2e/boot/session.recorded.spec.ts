import { test, expect, waitForAppReady } from '../fixtures';

test('signed-in shell renders from the recorded session and survives a reload', async ({ app, recordedTraffic }) => {
    await expect(app).not.toHaveURL(/\/welcome/);
    await expect(app.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();

    // Boot verified the token against the identity (answered from the HAR on
    // replay). The body is encrypted with the session's shared secret.
    const verify = recordedTraffic!.responses.find(
        (r) => r.request().method() === 'GET' && /\/auth\/verifytoken/i.test(r.url()),
    );
    expect(verify?.status()).toBe(200);

    await app.reload();
    await waitForAppReady(app);

    await expect(app).not.toHaveURL(/\/welcome/);
    await expect(app.getByRole('complementary', { name: 'Sidebar' })).toBeVisible();
});
