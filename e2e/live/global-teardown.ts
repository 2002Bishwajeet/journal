// Cleans up the live tier's isolation folder(s) on the real identity: this
// run's own folder (named by global-setup.ts) is always removed, and any
// leftover `e2e-*` folder older than 24h is swept too (e.g. a crashed prior
// run that never reached its own cleanup). Runs after tests but while the
// webServer is still up (Playwright tears servers down after globalTeardown).
import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { assertTestOrigin } from '../support/origin-guard';
import { waitForAppReady } from '../fixtures';
import { foldersNav, deleteFolder } from '../support/actions';

const STORAGE_STATE_PATH = 'e2e/.auth/live.json';
const APP_URL = 'https://e2e.dotyou.cloud:4443/';
const SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// Matches the `e2e-<ISO date>-<random 6>` scheme global-setup.ts generates.
const FOLDER_NAME_RE = /^e2e-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)-[0-9a-z]{6}$/;

export default async function globalTeardown(): Promise<void> {
    const identity = process.env.E2E_LIVE_IDENTITY;
    // No identity (e.g. a hermetic-only invocation somehow reaching this
    // config) or no session to act with (login never ran/succeeded) — nothing
    // to clean up.
    if (!identity || !existsSync(STORAGE_STATE_PATH)) return;

    const browser = await chromium.launch({
        args: [
            '--host-resolver-rules=MAP e2e.dotyou.cloud 127.0.0.1',
            '--ignore-certificate-errors',
        ],
    });
    try {
        const context = await browser.newContext({ storageState: STORAGE_STATE_PATH, ignoreHTTPSErrors: true });
        const page = await context.newPage();
        await page.goto(APP_URL);
        await assertTestOrigin(page);
        await waitForAppReady(page);

        const names = await foldersNav(page).getByRole('button').allTextContents();
        const now = Date.now();

        for (const raw of names) {
            const name = raw.trim();
            const match = FOLDER_NAME_RE.exec(name);
            if (!match) continue;

            const isThisRun = name === process.env.E2E_LIVE_RUN_FOLDER;
            const isStale = now - new Date(match[1]).getTime() > SWEEP_MAX_AGE_MS;
            if (isThisRun || isStale) {
                await deleteFolder(page, name);
            }
        }
    } finally {
        await browser.close();
    }
}
