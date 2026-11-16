import { existsSync } from 'node:fs';
import type { Browser, Page } from '@playwright/test';
import { test, expect, waitForAppReady, withFencedPage } from '../fixtures';
import { assertTestOrigin } from '../support/origin-guard';
import { activeEditor, screenshotInBothThemes } from '../support/actions';

// #1250: the /voice capture screen and the transcript → note pipeline, on the scripted engines
// (native/web/voice/fakes.ts) that window.__JOURNAL_VOICE_FAKES__ turns on. The app is forced
// native through the init-script globals, as in paywall.spec.ts; no plugin sells, so it is unlocked.

const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 800 };
const AUTH = { storageState: 'e2e/fixtures/hermetic-auth.json' };

const SENTENCES = [
    'the garden needs fresh soil and I want tomatoes along the fence this spring.',
    'um the kitchen tap still drips so we should replace the washer soon.',
    'the garden shed needs a new lock before the tools go missing again.',
];
// Two paragraphs: a pause of 3 s after the second sentence.
const SEGMENTS = SENTENCES.map((text, i) => ({ text, startMs: i * 5000 + (i > 1 ? 3000 : 0), endMs: i * 5000 + 4000 + (i > 1 ? 3000 : 0) }));

interface Fakes {
    holdAfter?: number;
}

async function openVoice(browser: Browser, platform: 'ios' | 'macos', fakes: Fakes, body: (page: Page) => Promise<void>): Promise<void> {
    await withFencedPage(browser, AUTH, async (page) => {
        await page.addInitScript(
            ({ platform, segments, holdAfter }) => {
                const w = window as unknown as Record<string, unknown>;
                w.__JOURNAL_NATIVE__ = { platform, plugins: [] };
                w.__TAURI_INTERNALS__ = { transformCallback: () => 0, invoke: async () => null };
                w.__JOURNAL_VOICE_FAKES__ = { speech: { segments, intervalMs: 150, holdAfter }, formatter: {} };
            },
            { platform, segments: SEGMENTS, holdAfter: fakes.holdAfter },
        );
        await page.setViewportSize(platform === 'ios' ? PHONE : DESKTOP);
        await page.goto('/voice');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await body(page);
    });
}

const capture = (page: Page) => page.getByRole('region', { name: 'Voice note' });
const reviewBar = (page: Page) => page.getByRole('toolbar', { name: 'Voice note review' });
/** The note's "Original transcript" toggle (its title is an input). */
const transcriptToggle = (page: Page) => activeEditor(page).getByLabel('Toggle title');

/** First use: the privacy line, then the microphone; records until every scripted final is in. */
async function recordAll(page: Page) {
    await expect(capture(page).getByText('Audio stays on this device and is not kept')).toBeVisible();
    await capture(page).getByRole('button', { name: 'Allow microphone' }).click();
    await expect(capture(page).getByLabel('Transcript')).toContainText('before the tools go missing again.');
}

test('the web has no voice screen: /voice goes home, with no microphone prompt', async ({ browser }) => {
    await withFencedPage(browser, AUTH, async (page) => {
        await page.goto('/voice');
        await assertTestOrigin(page);
        await waitForAppReady(page);
        await expect(page).not.toHaveURL(/\/voice$/);
        await expect(page.getByRole('button', { name: 'Allow microphone' })).toHaveCount(0);
        await expect(page.getByRole('region', { name: 'Voice note' })).toHaveCount(0);
    });
});

test.describe('voice notes', () => {
    test.skip(!existsSync('native/web/index.ts'), 'needs the private native/ module');

    test('phone: record, Done makes the note, Re-format as an outline, Keep removes the transcript', async ({ browser }) => {
        await openVoice(browser, 'ios', {}, async (page) => {
            await recordAll(page);
            await expect(capture(page).getByRole('button', { name: 'Pause' })).toBeVisible();
            await expect(capture(page).getByRole('button', { name: 'Language: English (US)' })).toBeDisabled();
            await screenshotInBothThemes(page, (theme) => `capture-${theme}-phone.png`);

            await capture(page).getByRole('button', { name: 'Pause' }).click();
            await expect(capture(page).getByRole('button', { name: 'Resume' })).toBeVisible();
            await capture(page).getByRole('button', { name: 'Done' }).click();

            await expect(page).not.toHaveURL(/\/voice$/);
            const editor = activeEditor(page);
            await expect(editor.getByRole('heading', { name: 'Garden' })).toBeVisible();
            await expect(editor).toContainText('The kitchen tap still drips so we should replace the washer soon.');
            await expect(transcriptToggle(page)).toHaveValue('Original transcript');
            const bar = reviewBar(page);
            await expect(bar.getByRole('button', { name: 'Keep' })).toBeVisible();
            await screenshotInBothThemes(page, (theme) => `review-bar-${theme}-phone.png`);

            await bar.getByRole('button', { name: 'Re-format' }).click();
            await page.getByRole('menuitem', { name: /^Outline/ }).click();
            await expect(editor.locator('ul li').first()).toContainText('The garden needs fresh soil');
            await expect(transcriptToggle(page)).toHaveValue('Original transcript');

            await bar.getByRole('button', { name: 'Keep' }).click();
            await expect(bar).toHaveCount(0);
            await expect(transcriptToggle(page)).toHaveCount(0);
            await expect(editor.locator('ul li').first()).toContainText('The garden needs fresh soil');
        });
    });

    test('desktop: the compact capture view, then the review bar on the note', async ({ browser }) => {
        await openVoice(browser, 'macos', {}, async (page) => {
            await recordAll(page);
            await screenshotInBothThemes(page, (theme) => `capture-${theme}-desktop.png`);
            await capture(page).getByRole('button', { name: 'Done' }).click();

            // The e2e build sells on desktop: the first launch of the app shows the trial info once.
            await page.getByRole('dialog', { name: 'Try Journal free for 3 days' }).getByRole('button', { name: 'Continue' }).click();
            await expect(activeEditor(page).getByRole('heading', { name: 'Garden' })).toBeVisible();
            const bar = reviewBar(page);
            await expect(bar.getByRole('button', { name: 'Use transcript' })).toBeVisible();
            await screenshotInBothThemes(page, (theme) => `review-bar-${theme}-desktop.png`);

            await bar.getByRole('button', { name: 'Use transcript' }).click();
            await expect(activeEditor(page).getByRole('heading', { name: 'Garden' })).toHaveCount(0);
            await expect(activeEditor(page)).toContainText('The garden needs fresh soil');
        });
    });

    test('a recording cut off by a reload is offered again with every final it had', async ({ browser }) => {
        await openVoice(browser, 'ios', { holdAfter: 2 }, async (page) => {
            await capture(page).getByRole('button', { name: 'Allow microphone' }).click();
            await expect(capture(page).getByLabel('Transcript')).toContainText('replace the washer soon.');

            // PGlite writes IndexedDB lazily: flush, so the reload (the kill) finds what was saved.
            await page.evaluate(() => window.__journalE2E!.syncToDisk());
            await page.reload();
            await waitForAppReady(page);
            await expect(capture(page).getByText('Finish your voice note')).toBeVisible();
            await capture(page).getByRole('button', { name: 'Finish' }).click();

            const editor = activeEditor(page);
            await expect(editor).toContainText('The garden needs fresh soil');
            await expect(editor).toContainText('replace the washer soon.');
            await expect(editor).not.toContainText('garden shed');
        });
    });
});
