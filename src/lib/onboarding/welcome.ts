import { getAppState, saveAppState, hasAnyNote } from '@/lib/db';
import { createNoteFromMarkdownInDb } from '@/lib/notes/createNote';
import { MAIN_FOLDER_ID, WelcomeSeededDriveProvider } from '@/lib/homebase';
import type { DotYouClient } from '@homebase-id/js-lib/core';
import welcomeMarkdown from './welcomeNote.md?raw';

export const WELCOME_TITLE = 'Welcome to Journal';
export const WELCOME_SEEDED_KEY = 'welcome-note-seeded';

/** Seed only when the welcome note was never offered, here or on another device, and nothing exists yet. */
export function shouldSeedWelcome(state: { seededLocally: boolean; seededRemotely: boolean; hasNotes: boolean }): boolean {
    return !state.seededLocally && !state.seededRemotely && !state.hasNotes;
}

/**
 * First sign-in (#1283): create the one "Welcome to Journal" note for an identity with no notes.
 * The seeded flag is kept in app_state and, best effort, as a marker file on the drive so another
 * device (or a sign-in after the note was deleted for good) never seeds again. An unreachable
 * drive counts as "not marked": a brand-new account offline still gets its note.
 */
export async function seedWelcomeNote(client: DotYouClient): Promise<{ docId: string; folderId: string } | null> {
    if (await getAppState<boolean>(WELCOME_SEEDED_KEY)) return null;

    const marker = new WelcomeSeededDriveProvider(client);
    const seededRemotely = await marker.exists().catch(() => false);
    const seed = shouldSeedWelcome({ seededLocally: false, seededRemotely, hasNotes: await hasAnyNote() });

    const note = seed
        ? await createNoteFromMarkdownInDb({ title: WELCOME_TITLE, content: welcomeMarkdown, folderId: MAIN_FOLDER_ID })
        : null;
    await saveAppState(WELCOME_SEEDED_KEY, true);
    if (!seededRemotely) await marker.mark().catch((err: unknown) => console.warn('[welcome] Could not write the marker:', err));
    return note;
}
