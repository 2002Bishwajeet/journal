import { useMemo } from 'react';
import { createNoteWithContentInDb, useNotesByFolder } from './useNotes';
import { useFolders, findOrCreateFolderByName } from './useFolders';
import { getSearchIndexEntry } from '@/lib/db';
import { MAIN_FOLDER_ID } from '@/lib/homebase';
import { todayTitle } from './useDailyNote';

// Templates are ordinary notes living in a folder named `Templates` — there is
// no separate template store or editor (that IS the design; see plan scope).
export const TEMPLATES_FOLDER_NAME = 'Templates';

/**
 * Replace `{{date}}` tokens with today's local date (YYYY-MM-DD). Pure — the
 * only template placeholder this app supports by design.
 */
export function applyTemplateSubstitutions(content: string, now: Date = new Date()): string {
    return content.replace(/\{\{date\}\}/g, todayTitle(now));
}

export interface TemplateSummary {
    docId: string;
    title: string;
}

/**
 * Note templates: lists the notes in the `Templates` folder (live, empty when
 * the folder is absent) and spawns new notes from them with `{{date}}` filled
 * in. Creating a template lazily creates the `Templates` folder plus a starter
 * note. The caller navigates to the returned note.
 */
export function useTemplates() {
    const {
        get: { data: folders = [] },
    } = useFolders();

    // First-created folder wins if names collide (names aren't unique).
    const templatesFolderId = useMemo(
        () =>
            folders
                .filter((f) => f.name === TEMPLATES_FOLDER_NAME)
                .toSorted((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))[0]?.id,
        [folders],
    );

    const { data: notes = [] } = useNotesByFolder(templatesFolderId);
    const templates: TemplateSummary[] = useMemo(
        () => notes.map((n) => ({ docId: n.docId, title: n.title || 'Untitled' })),
        [notes],
    );

    // Spawn a note from a template: copy its content (and title) with {{date}}
    // substituted. Lands in the Main folder — a template spawn is a global
    // action, not scoped to the currently open folder.
    const createFromTemplate = async (
        templateDocId: string,
    ): Promise<{ docId: string; folderId: string }> => {
        const entry = await getSearchIndexEntry(templateDocId);
        const now = new Date();
        const title = applyTemplateSubstitutions(entry?.title || 'Untitled', now);
        const content = applyTemplateSubstitutions(entry?.plainTextContent || '', now);
        const { docId } = await createNoteWithContentInDb({ title, content, folderId: MAIN_FOLDER_ID });
        return { docId, folderId: MAIN_FOLDER_ID };
    };

    // Create the Templates folder (if needed) plus a starter template note for
    // the user to edit. Ordinary note — editing it IS editing the template.
    const createTemplate = async (): Promise<{ docId: string; folderId: string }> => {
        const folderId = await findOrCreateFolderByName(TEMPLATES_FOLDER_NAME);
        const { docId } = await createNoteWithContentInDb({
            title: 'New template',
            content: '# {{date}}\n\n',
            folderId,
        });
        return { docId, folderId };
    };

    return { templates, createFromTemplate, createTemplate };
}
