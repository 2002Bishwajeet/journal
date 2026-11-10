import { test, expect, waitForAppReady } from '../fixtures';
import { activeTitleInput } from '../support/actions';
import { assertTestOrigin } from '../support/origin-guard';

// #1047: a link to your own note that this device hasn't synced yet waits for the sync,
// then fetches that one note by id. It says "Note not found" only after that check.
// The note's header is answered here; the hermetic drive has nothing else. The app
// encrypts query strings, so a header request can't be told apart by the id it asks for.

const MAIN_FOLDER_ID = '06cf9262-4eae-4276-b0d1-8ca3cf5be6f4';
const NOTE_ID = '00000000-0000-4000-8000-000000001047';
const MISSING_ID = '00000000-0000-4000-8000-000000000404';

const noteHeader = {
    fileId: 'seeded-remote-note',
    fileState: 'active',
    fileSystemType: 'Standard',
    fileMetadata: {
        isEncrypted: false,
        versionTag: 'seeded-version',
        created: 1,
        updated: 1,
        payloads: [],
        appData: { uniqueId: NOTE_ID, fileType: 605, dataType: 0, content: JSON.stringify({ title: 'Project report' }) },
    },
    serverMetadata: { accessControlList: { requiredSecurityGroup: 'Owner' } },
    sharedSecretEncryptedKeyHeader: { iv: '', encryptedAesKey: '', encryptionVersion: 1, type: 11 },
};

test.beforeEach(async ({ app }) => {
    // Records whether "Note not found" was ever on screen, even for one frame
    await app.addInitScript(() => {
        const w = window as unknown as { __sawNotFound?: boolean };
        new MutationObserver(() => {
            if (document.body?.innerText.includes('Note not found')) w.__sawNotFound = true;
        }).observe(document, { childList: true, subtree: true, characterData: true });
    });
    await app.route('**/drive/files/payload**', (route) => route.fulfill({ status: 404 }));
});

const sawNotFound = (page: import('@playwright/test').Page) =>
    page.evaluate(() => (window as unknown as { __sawNotFound?: boolean }).__sawNotFound === true);

test('a link to a note not synced here yet waits, then opens the note', async ({ app }) => {
    let answer!: () => void;
    const answered = new Promise<void>((resolve) => { answer = resolve; });
    await app.route('**/drive/query/specialized/cuid/header**', async (route) => {
        await answered;
        return route.fulfill({ json: noteHeader });
    });

    await app.goto(`/${MAIN_FOLDER_ID}/${NOTE_ID}`);
    await assertTestOrigin(app);
    await waitForAppReady(app);

    const main = app.locator('#main-content');
    await expect(main.getByText('Looking for this note…')).toBeVisible();
    answer();

    await expect(activeTitleInput(app)).toHaveValue('Project report');
    expect(await sawNotFound(app)).toBe(false);
});

test('a link to a note that is nowhere ends at "Note not found"', async ({ app }) => {
    let checks = 0;
    await app.route('**/drive/query/specialized/cuid/header**', (route) => {
        checks++;
        return route.fulfill({ status: 404 });
    });

    await app.goto(`/${MAIN_FOLDER_ID}/${MISSING_ID}`);
    await assertTestOrigin(app);
    await waitForAppReady(app);

    const main = app.locator('#main-content');
    await expect(main.getByText('Note not found')).toBeVisible();
    await expect(main.getByRole('button', { name: 'Close tab', exact: true })).toBeVisible();
    expect(checks).toBe(1);
});
