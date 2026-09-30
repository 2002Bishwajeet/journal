import { test, expect, waitForAppReady } from '../fixtures';
import { activeEditor, createNote, waitForSyncIdle } from '../support/actions';

// Layer 3, not layer 2 (#202): a replay can't cover this flow, for the same
// reason as editor/create-edit.live.spec.ts — the pull after the reload
// returns the recording's note under a different uniqueId, and the app fetches
// a payload the recording never did.

// ProseMirror also renders an <img class="ProseMirror-separator"> of its own.
const NOTE_IMAGE = 'img:not(.ProseMirror-separator)';

test('an image added from the toolbar uploads and renders after a reload', async ({ liveRun }) => {
    const { page } = liveRun;
    await createNote(page, { title: `Image note ${Date.now()}`, body: 'Image below.' });

    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Add Image' }).filter({ visible: true }).click();
    await (await chooser).setFiles('e2e/fixtures/files/sample.png');
    await expect(activeEditor(page).locator(NOTE_IMAGE)).toBeVisible();
    await waitForSyncIdle(page);

    await page.reload();
    await waitForAppReady(page);

    const image = activeEditor(page).locator(NOTE_IMAGE);
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
});
