// Layer 3 (#206, part of the agent-access epic #164): proves an edit made by
// the real Journal MCP server (mcp/) reaches a note open in the app, merges
// with concurrent typing instead of overwriting it, and that an ungranted
// folder's note stays invisible to every tool.
//
// This is the one live spec that also needs its own MCP login -- the Journal
// MCP server has its own Homebase app registration, separate from the app's
// (see mcp/README.md). That's a one-time `npm run mcp:login -- <identity>`
// only a human can approve in the identity's owner console, so:
//   - it never runs in CI (no OS keychain there, and epic #164 explicitly
//     keeps running the MCP server itself out of scope for CI);
//   - locally, it skips with a clear message until that login has been done
//     for the exact identity this run targets (E2E_LIVE_IDENTITY) -- never
//     falling back to silently using credentials saved for a different
//     identity, which could otherwise mean this spec creates/edits notes on
//     someone's real journal instead of the throwaway test identity.
import crypto from 'node:crypto';
import { test, expect, waitForAppReady } from '../fixtures';
import { createNote, openNote, typeInEditor, activeEditor, createFolder, selectFolder, deleteFolder, setFolderAgentAccess } from '../support/actions';
import { loadCredentials } from '../../mcp/credentials';
import { startJournalMcp, callToolJson } from '../support/mcp-client';

test.skip(!!process.env.CI, 'needs local keychain login');

const identity = process.env.E2E_LIVE_IDENTITY;
// Not read at all in CI (the skip above already applies there) -- avoids
// ever touching the OS keychain backend on a runner that has none.
const creds = process.env.CI ? null : loadCredentials();
test.skip(
    !creds,
    `No Journal MCP credentials in this machine's OS keychain. Run: npm run mcp:login -- ${identity ?? '<identity>'} ` +
        '(the live-tier test identity, never your real journal) once, then re-run this spec.'
);
test.skip(
    creds !== null && creds.identity !== identity,
    `Journal MCP credentials are for ${creds?.identity}, not the live-tier identity ${identity} (E2E_LIVE_IDENTITY). ` +
        `Run npm run mcp:login -- ${identity} for the test identity, never your real journal.`
);

interface NoteRow {
    id: string;
    title: string;
}

/** The `/:folderId/:noteId` route (src/App.tsx) puts the note's own id, the
 * same id the MCP tools use, in the URL -- read after navigating to a note. */
function noteIdFromUrl(url: string): string {
    const segments = new URL(url).pathname.split('/').filter(Boolean);
    return segments[1];
}

test('an MCP edit reaches a note open in the app, merges with concurrent typing, and ungranted notes stay hidden', async ({
    liveRun,
}) => {
    const { page, folderName } = liveRun;
    const runId = Date.now();
    const targetTitle = `MCP target ${runId}`;
    const privateFolderName = `e2e-${runId}-private`;
    const privateTitle = `MCP private ${runId}`;

    const mcp = await startJournalMcp();
    try {
        await setFolderAgentAccess(page, folderName, 'write');
        await createNote(page, { title: targetTitle, body: 'seed' });

        // A second, ungranted folder -- its note must stay invisible to every tool.
        await createFolder(page, privateFolderName);
        await selectFolder(page, privateFolderName);
        await createNote(page, { title: privateTitle, body: 'never visible to agents' });
        const privateId = noteIdFromUrl(page.url());

        try {
            // The grant is a real drive write (#168); poll instead of a fixed
            // sleep for it to become visible to a fresh loadGrants() call.
            await expect
                .poll(
                    async () => {
                        const notes = await callToolJson<NoteRow[]>(mcp.client, 'list_notes', { limit: 200 });
                        return notes.some((note) => note.title === targetTitle);
                    },
                    { timeout: 20_000 }
                )
                .toBe(true);
            const notes = await callToolJson<NoteRow[]>(mcp.client, 'list_notes', { limit: 200 });
            const target = notes.find((note) => note.title === targetTitle);
            if (!target) throw new Error('target note missing from list_notes after polling found it');
            expect(notes.map((note) => note.title)).not.toContain(privateTitle);

            // Ungranted note and a random id fail identically -- no distinction
            // an agent could use to tell "exists but hidden" from "doesn't exist".
            await expect(callToolJson(mcp.client, 'get_note', { id: privateId })).rejects.toThrow(
                `Note not found: ${privateId}`
            );
            const randomId = crypto.randomUUID();
            await expect(callToolJson(mcp.client, 'get_note', { id: randomId })).rejects.toThrow(
                `Note not found: ${randomId}`
            );

            await selectFolder(page, folderName);
            await openNote(page, targetTitle);
            const typing = typeInEditor(page, 'human line');
            await callToolJson(mcp.client, 'append_to_note', { id: target.id, markdown: `agent line ${runId}` });
            await typing;

            // No reload: the edit reaches the open editor over the websocket,
            // merged with the concurrent keystrokes rather than overwriting them.
            await expect(activeEditor(page)).toContainText('human line', { timeout: 30_000 });
            await expect(activeEditor(page)).toContainText(`agent line ${runId}`, { timeout: 30_000 });

            await page.reload();
            await waitForAppReady(page);
            await expect(activeEditor(page)).toContainText('human line');
            await expect(activeEditor(page)).toContainText(`agent line ${runId}`);

            await callToolJson(mcp.client, 'replace_in_note', {
                id: target.id,
                old_text: `agent line ${runId}`,
                new_text: `agent edit ${runId}`,
            });
            await expect(activeEditor(page)).toContainText(`agent edit ${runId}`, { timeout: 30_000 });
        } finally {
            await deleteFolder(page, privateFolderName);
        }
    } finally {
        await mcp.stop();
    }
});
