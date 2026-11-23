import type { Browser, Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { fakeKeychain } from '../support/fakeKeychain';
import { activeTitleInput, openSettingsSection, settingsPanel, typeInEditor } from '../support/actions';

// #1439: the system rating dialog in the native app. The app is forced native through the init-script
// globals, as in paywall.spec.ts, with the bridge plugin listed and its request_review command faked
// and counted. The review state starts with two earlier days of saving notes, so today is the third.

const AUTH = { storageState: 'e2e/fixtures/hermetic-auth.json' };

async function openApp(browser: Browser, platform: 'ios' | 'macos', body: (page: Page) => Promise<void>): Promise<void> {
    await withFencedPage(browser, AUTH, async (page) => {
        await page.addInitScript((platform) => {
            const w = window as unknown as Record<string, unknown>;
            w.__JOURNAL_NATIVE__ = { platform, plugins: ['journal-bridge'] };
            w.__TAURI_INTERNALS__ = {
                transformCallback: () => 0,
                invoke: async (cmd: string) => {
                    if (cmd === 'plugin:journal-db-key|database_key') return { key: Array<number>(32).fill(7) };
                    if (cmd === 'plugin:journal-bridge|request_review') {
                        localStorage.setItem('e2e-review-requests', String(Number(localStorage.getItem('e2e-review-requests') ?? 0) + 1));
                    }
                    return null;
                },
            };
            if (localStorage.getItem('journal-review-prompt') === null) {
                localStorage.setItem('journal-review-prompt', JSON.stringify({ days: ['2020-01-01', '2020-01-02'], lastVersion: null, lastAt: null }));
            }
        }, platform);
        await fakeKeychain(page);
        await page.setViewportSize(platform === 'ios' ? { width: 390, height: 844 } : { width: 1280, height: 800 });
        await page.goto('/');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await body(page);
    });
}

const requests = (page: Page) => page.evaluate(() => Number(localStorage.getItem('e2e-review-requests') ?? 0));
// createNote waits for the new note's row in the list, which a phone hides behind the open note.
async function writeNote(page: Page, title: string, body: string): Promise<void> {
    const before = page.url();
    await page.getByRole('button', { name: /^New( note)?$/ }).click();
    await page.waitForURL((url) => url.href !== before);
    await expect(activeTitleInput(page)).toHaveValue('Untitled');
    await activeTitleInput(page).fill(title);
    await typeInEditor(page, body);
}
const closeNote = (page: Page) => page.getByRole('button', { name: /^Back to/ }).click();

test('asks for a rating once after the threshold and not again in the same version', async ({ browser }) => {
    await openApp(browser, 'ios', async (page) => {
        for (const title of ['One', 'Two', 'Three', 'Four', 'Five']) {
            await writeNote(page, title, `Entry ${title}`);
            await closeNote(page);
        }
        await expect.poll(() => requests(page)).toBe(1);

        // A phone's Back lands on the folder list, so another saved note stands in for reopening one.
        await writeNote(page, 'Six', 'Entry Six');
        await closeNote(page);
        await expect(page.getByRole('button', { name: 'New note' })).toBeVisible();
        expect(await requests(page)).toBe(1);
    });
});

test('Settings -> About has a Rate row on iOS and none on desktop', async ({ browser }) => {
    const aboutPanel = async (page: Page) => {
        await page.getByRole('button', { name: 'Settings' }).click();
        const dialog = page.getByRole('dialog', { name: 'Settings' });
        await openSettingsSection(dialog, 'About');
        return settingsPanel(dialog);
    };
    await openApp(browser, 'ios', async (page) => {
        const panel = await aboutPanel(page);
        await expect(panel.getByRole('button', { name: 'Rate' })).toBeVisible();
    });
    await openApp(browser, 'macos', async (page) => {
        const panel = await aboutPanel(page);
        await expect(panel.getByRole('heading', { name: 'Version' })).toBeVisible();
        await expect(panel.getByRole('button', { name: 'Rate' })).toHaveCount(0);
    });
});
