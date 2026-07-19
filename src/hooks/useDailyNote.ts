import { createNoteFromTemplateInDb, createNoteWithContentInDb } from './useNotes';
import { findOrCreateFolderByName } from './useFolders';
import { getActiveNoteByTitle } from '@/lib/db';
import { MAIN_FOLDER_ID } from '@/lib/homebase';

const DAILY_FOLDER_NAME = 'Daily';
const DAILY_TEMPLATE_TITLE = 'Daily template';

/**
 * Local-time `YYYY-MM-DD` for `now` (default: the current time). This is the
 * daily note's title and the stable key the find-or-create logic matches on.
 * Computed from local calendar fields (not UTC) so the note a user opens at
 * 11pm and again at 1am the next day map to different days — and every open
 * within one local day maps to the same note.
 */
export function todayTitle(now: Date = new Date()): string {
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export interface DailyNoteResult {
    docId: string;
    folderId: string;
    created: boolean;
}

/**
 * Find-or-create decision for the daily note, isolated from React so it can be
 * unit-tested against a real database. Reuses an existing ACTIVE note titled
 * with today's date; a trashed/archived note with the same title does NOT block
 * a fresh create (getActiveNoteByTitle ignores it). `created` reports whether a
 * new note was made, so it is idempotent per calendar day.
 */
export async function findOrCreateDailyNote(
    now: Date,
    createDailyNote: (title: string) => Promise<{ docId: string; folderId: string }>,
): Promise<DailyNoteResult> {
    const title = todayTitle(now);
    const existing = await getActiveNoteByTitle(title);
    if (existing) {
        return { docId: existing.docId, folderId: existing.folderId, created: false };
    }
    const { docId, folderId } = await createDailyNote(title);
    return { docId, folderId, created: true };
}

/**
 * Daily notes ("Today"): open — or lazily create — the note titled with today's
 * local date inside a `Daily` folder. Idempotent per day. The caller navigates
 * to the returned note (hooks don't route here).
 */
export function useDailyNote() {
    const openToday = async (): Promise<{ docId: string; folderId: string }> => {
        const { docId, folderId } = await findOrCreateDailyNote(new Date(), async (title) => {
            let folderId: string;
            try {
                folderId = await findOrCreateFolderByName(DAILY_FOLDER_NAME);
            } catch {
                // Folder creation is a local PGlite insert, so this path is
                // essentially unreachable offline; fall back to Main so opening
                // "Today" never hard-fails.
                folderId = MAIN_FOLDER_ID;
            }
            const template = await getActiveNoteByTitle(DAILY_TEMPLATE_TITLE);
            // Copy the template's Yjs document so its formatting survives; the
            // plain-text fallback is only the templateless starter heading.
            const res = template
                ? await createNoteFromTemplateInDb({
                      templateDocId: template.docId,
                      title,
                      folderId,
                      dateString: title,
                  })
                : await createNoteWithContentInDb({ title, content: `# ${title}\n\n`, folderId });
            return { docId: res.docId, folderId };
        });
        return { docId, folderId };
    };

    return { openToday };
}
