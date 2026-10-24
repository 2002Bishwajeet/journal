// Cleans up the live tier's isolation folder(s) on the real identity: this
// run's own folder(s) (named by global-setup.ts) are always removed, and any
// leftover `e2e-*` folder older than 1h is swept too (e.g. a crashed prior
// run that never reached its own cleanup). Runs after tests but while the
// webServer is still up (Playwright tears servers down after globalTeardown).
// Then, on the owner and on each peer with a storage state, it deletes the notes
// and invites the e2e/sharing specs create outside the run folder (the shared
// note moves out of it, and the peer keeps its own copy and invite after a
// revoke), and removes the peer/outsider storage state those specs used. Each
// deleted item is logged; any item that can't be deleted is named and fails
// the run.
import { chromium, type Browser, type FullConfig, type Page } from '@playwright/test';
import { existsSync, rmSync } from 'node:fs';
import { assertTestOrigin } from '../support/origin-guard';
import { waitForAppReady, skipWhatsNew, LIVE_SHARING_IDENTITIES } from '../fixtures';
import { foldersNav, deleteFolder, unshareFolderIfShared } from '../support/actions';

const SWEEP_MAX_AGE_MS = 60 * 60 * 1000;
// Matches only the `e2e-<ISO date>-<random 6>-w<worker>` names the `liveRun`
// fixture creates — nothing else on the identity is ever deleted.
const FOLDER_NAME_RE = /^e2e-(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)-[0-9a-z]{6}-w\d+$/;
// The note title e2e/sharing/circle-share.live.spec.ts uses, and nothing else.
const SHARED_NOTE_TITLE_RE = /^Circle share \d+$/;

export default async function globalTeardown(config: FullConfig): Promise<void> {
    try {
        await deleteRunFolders(config);
    } finally {
        // Not after e2e:live:docker's setup-only invocation (--project=live-ci-setup):
        // it writes these files for the `live` invocation that follows. The
        // owner's live.json stays — the hand-login tier reuses it, and the Docker
        // script's cleanup removes it.
        if (!process.argv.some((arg) => arg.includes('live-ci-setup'))) {
            for (const { storageState } of LIVE_SHARING_IDENTITIES) rmSync(storageState, { force: true });
        }
    }
}

async function deleteRunFolders(config: FullConfig): Promise<void> {
    const live = config.projects.find((p) => p.name === 'live');
    const storageState = live?.use.storageState as string | undefined;
    // No identity or no session to act with (login never ran) — nothing to clean up.
    if (!live || !process.env.E2E_LIVE_IDENTITY || !storageState || !existsSync(storageState)) return;

    const failures: string[] = [];
    // One failed item must not stop the rest of the sweep; all are reported at the end.
    const attempt = async (label: string, action: () => Promise<void>) => {
        try {
            await action();
        } catch (error) {
            console.error(`[live teardown] FAILED to delete ${label}: ${error}`);
            failures.push(label);
        }
    };

    const browser = await chromium.launch(live.use.launchOptions);
    try {
        await withSignedInPage(browser, storageState, live.use.baseURL!, async (page) => {
            const names = await foldersNav(page).getByRole('button').allTextContents();
            const runPrefix = `${process.env.E2E_LIVE_RUN_FOLDER}-w`;
            for (const name of names.map((n) => n.trim())) {
                const match = FOLDER_NAME_RE.exec(name);
                if (!match) continue;
                if (name.startsWith(runPrefix) || Date.now() - new Date(match[1]).getTime() > SWEEP_MAX_AGE_MS) {
                    await attempt(`folder ${name}`, async () => {
                        // Unshare first so the notes leave the demo author page's public index.
                        await unshareFolderIfShared(page, name);
                        await deleteFolder(page, name);
                        console.log(`[live teardown] deleted folder ${name}`);
                    });
                }
            }
        });

        const identities = [
            { identity: process.env.E2E_LIVE_IDENTITY, storageState },
            ...LIVE_SHARING_IDENTITIES.filter((peer) => existsSync(peer.storageState)),
        ];
        for (const { identity, storageState: state } of identities) {
            await attempt(`shared notes and invites on ${identity}`, () =>
                withSignedInPage(browser, state, live.use.baseURL!, async (page) => {
                    const titles = await page.evaluate((pattern) => window.__journalE2E!.deleteFilesTitled(pattern), SHARED_NOTE_TITLE_RE.source);
                    for (const title of titles) console.log(`[live teardown] deleted "${title}" on ${identity}`);
                }));
        }
    } finally {
        await browser.close();
    }
    if (failures.length) throw new Error(`live teardown could not delete: ${failures.join(', ')}`);
}

async function withSignedInPage(browser: Browser, storageState: string, baseURL: string, body: (page: Page) => Promise<void>): Promise<void> {
    const context = await browser.newContext({ storageState, ignoreHTTPSErrors: true });
    try {
        const page = await context.newPage();
        await skipWhatsNew(page);
        await page.goto(baseURL);
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await body(page);
    } finally {
        await context.close();
    }
}
