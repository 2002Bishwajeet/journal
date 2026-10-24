/**
 * Turns the agent's call of `append_to_note` or `create_note` into a proposal for the user (#702).
 * The tool first runs against deps that write nothing, so a missing, excluded or trashed note, a
 * bad folder or a markdown error fails the call now, before the user is asked. Accept runs it again
 * with the real deps, against the note as it is then.
 */
import type { AnyJournalTool } from '@/lib/agent/tools/registry';
import type { ReadDeps } from '@/lib/agent/tools/read';
import type { WriteDeps } from '@/lib/agent/tools/write';
import type { WriteProposal, WrittenNote } from '@/lib/agent/approveWrite';
import { MAIN_FOLDER_ID } from '@/lib/homebase/config';

interface WriteContext {
    deps: ReadDeps;
    writeDeps: WriteDeps;
    /** The note open in the editor; its edits go through the editor tools, so its undo keeps working. */
    openNoteId?: string;
}

const noWrites = (deps: WriteDeps): WriteDeps => ({
    ...deps,
    uploadNoteEdit: async () => {},
    createNote: async () => {},
});

/** The args `append_to_note` and `create_note` take; the loop has already checked them against the tool's schema. */
type WriteArgs = {
    id?: string;
    title?: string;
    markdown: string;
    folderId?: string;
};

export async function proposeWrite(
    tool: AnyJournalTool,
    toolArgs: Record<string, unknown>,
    { deps, writeDeps, openNoteId }: WriteContext
): Promise<WriteProposal> {
    const args = toolArgs as unknown as WriteArgs;
    const { markdown } = args;
    if (tool.name === 'append_to_note') {
        if (args.id === openNoteId) throw new Error('Use the editor tools for the open note');
        await tool.execute(noWrites(writeDeps), args);
        const note = (await writeDeps.fetchNoteForEdit(args.id!))!;
        const { id, title, folderId } = note.summary;
        return {
            summary: `Append to '${title}'`,
            markdown,
            apply: async () => {
                await tool.execute(writeDeps, args);
                return { id, title, folderId };
            },
        };
    }
    if (tool.name === 'create_note') {
        await tool.execute(noWrites(writeDeps), args);
        const folderId = args.folderId ?? MAIN_FOLDER_ID;
        const folder = (await deps.listFolders()).find((f) => f.id === folderId);
        return {
            summary: `Create note '${args.title || 'Untitled'}' in ${folder?.name ?? 'Main'}`,
            markdown,
            apply: async () => (await tool.execute(writeDeps, args)).data as WrittenNote,
        };
    }
    throw new Error(`${tool.name} can't be used here.`);
}
