/**
 * Agent-access grants: what a local agent (Claude Code, Codex, ...) may see or edit.
 * Pure logic only — no imports from @/lib/db, React, or the Homebase SDK, so it can be
 * shared by the app and the MCP server (#164).
 */

export type AgentAccess = 'none' | 'read' | 'write';

export interface AgentGrants {
    version: 1;
    folders: Record<string, AgentAccess>;
    notes: Record<string, AgentAccess>;
}

export const EMPTY_GRANTS: AgentGrants = {
    version: 1,
    folders: {},
    notes: {},
};

const VALID_ACCESS: readonly AgentAccess[] = ['none', 'read', 'write'];

function isAgentAccess(value: unknown): value is AgentAccess {
    return typeof value === 'string' && (VALID_ACCESS as readonly string[]).includes(value);
}

/**
 * Resolve what an agent may do with a note. `excludeFromAI` always wins. A note-level
 * override (including 'none') beats its folder's grant. Falling through everything, the
 * default is 'none'.
 */
export function resolveAccess(
    grants: AgentGrants,
    { noteId, folderId, excludeFromAI }: { noteId: string; folderId: string; excludeFromAI?: boolean }
): AgentAccess {
    if (excludeFromAI === true) return 'none';

    const noteOverride = grants.notes[noteId];
    if (noteOverride !== undefined) return noteOverride;

    const folderGrant = grants.folders[folderId];
    if (folderGrant !== undefined) return folderGrant;

    return 'none';
}

export function folderAccess(grants: AgentGrants, folderId: string): AgentAccess {
    return grants.folders[folderId] ?? 'none';
}

/** Returns a new AgentGrants; never mutates `grants`. Setting 'none' deletes the folder's key. */
export function setFolderAccess(grants: AgentGrants, folderId: string, access: AgentAccess): AgentGrants {
    const folders = { ...grants.folders };
    if (access === 'none') {
        delete folders[folderId];
    } else {
        folders[folderId] = access;
    }
    return { ...grants, folders };
}

/** Returns a new AgentGrants; never mutates `grants`. `access: null` removes the note override. */
export function setNoteAccess(grants: AgentGrants, noteId: string, access: AgentAccess | null): AgentGrants {
    const notes = { ...grants.notes };
    if (access === null) {
        delete notes[noteId];
    } else {
        notes[noteId] = access;
    }
    return { ...grants, notes };
}

function parseAccessMap(value: unknown): Record<string, AgentAccess> {
    const result: Record<string, AgentAccess> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        if (isAgentAccess(entry)) result[key] = entry;
    }
    return result;
}

/** Returns EMPTY_GRANTS for anything that isn't {version:1, folders:object, notes:object}. */
export function parseGrants(json: unknown): AgentGrants {
    if (typeof json !== 'object' || json === null) return EMPTY_GRANTS;

    const candidate = json as { version?: unknown; folders?: unknown; notes?: unknown };
    if (
        candidate.version !== 1 ||
        typeof candidate.folders !== 'object' || candidate.folders === null ||
        typeof candidate.notes !== 'object' || candidate.notes === null
    ) {
        return EMPTY_GRANTS;
    }

    return {
        version: 1,
        folders: parseAccessMap(candidate.folders),
        notes: parseAccessMap(candidate.notes),
    };
}
