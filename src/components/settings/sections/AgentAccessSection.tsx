import { useState } from "react";
import { Label } from "@/components/ui/label";
import { useFolders } from "@/hooks/useFolders";
import { useNotesByFolder } from "@/hooks/useNotes";
import {
  useAgentGrants,
  buildNoteRows,
  type AgentAccessNoteRow,
} from "@/hooks/useAgentGrants";
import { folderAccess, type AgentAccess, type AgentGrants } from "@/lib/agent/grants";
import type { Folder } from "@/types";
import { SectionHeader } from "../SectionHeader";

const selectClass =
  "min-h-11 md:min-h-0 rounded-md border border-border bg-background text-sm px-2 py-1.5 shrink-0 disabled:opacity-60 disabled:cursor-not-allowed";

function FolderAccessRow({
  folder,
  grants,
  onSetFolder,
  onSetNote,
}: {
  folder: Folder;
  grants: AgentGrants;
  onSetFolder: (folderId: string, access: AgentAccess) => void;
  onSetNote: (noteId: string, access: AgentAccess | null) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="rounded-xl border border-border/60 bg-card">
      <div className="flex items-center justify-between gap-3 p-4">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => setIsOpen((v) => !v)}
            className="shrink-0 min-h-11 md:min-h-0 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            Notes
          </button>
          <Label className="truncate text-sm font-semibold">{folder.name}</Label>
        </div>
        <select
          aria-label={`Agent access for ${folder.name}`}
          value={folderAccess(grants, folder.id)}
          onChange={(e) => onSetFolder(folder.id, e.target.value as AgentAccess)}
          className={selectClass}
        >
          <option value="none">None</option>
          <option value="read">Read</option>
          <option value="write">Read + write</option>
        </select>
      </div>

      {isOpen && <FolderNotes folderId={folder.id} grants={grants} onSetNote={onSetNote} />}
    </div>
  );
}

/** Rendered only while the folder is expanded, so collapsed folders run no live query. */
function FolderNotes({
  folderId,
  grants,
  onSetNote,
}: {
  folderId: string;
  grants: AgentGrants;
  onSetNote: (noteId: string, access: AgentAccess | null) => void;
}) {
  const { data: notes } = useNotesByFolder(folderId);
  const noteRows = buildNoteRows(grants, folderId, notes);

  return (
    <div className="space-y-3 border-t border-border/60 px-4 py-3">
      {noteRows.length === 0 ? (
        <p className="text-xs text-muted-foreground">No notes in this folder.</p>
      ) : (
        noteRows.map((note) => (
          <NoteAccessRow key={note.noteId} note={note} onSetNote={onSetNote} />
        ))
      )}
    </div>
  );
}

function NoteAccessRow({
  note,
  onSetNote,
}: {
  note: AgentAccessNoteRow;
  onSetNote: (noteId: string, access: AgentAccess | null) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="truncate text-sm">{note.title || "Untitled"}</p>
        {note.locked && (
          <p className="text-xs text-muted-foreground">
            This note is excluded from AI features, so agents can never see it.
          </p>
        )}
      </div>
      {note.locked ? (
        <select
          aria-label={`Agent access for ${note.title}`}
          value="hidden"
          disabled
          className={selectClass}
        >
          <option value="hidden">Hidden from AI</option>
        </select>
      ) : (
        <select
          aria-label={`Agent access for ${note.title}`}
          value={note.override ?? "inherit"}
          onChange={(e) => {
            const value = e.target.value;
            onSetNote(note.noteId, value === "inherit" ? null : (value as AgentAccess));
          }}
          className={selectClass}
        >
          <option value="inherit">Same as folder</option>
          <option value="none">None</option>
          <option value="read">Read</option>
          <option value="write">Read + write</option>
        </select>
      )}
    </div>
  );
}

export default function AgentAccessSection() {
  const { grants, isLoaded, setFolder, setNote } = useAgentGrants();
  const { data: folders } = useFolders().get;

  return (
    <div className="space-y-10">
      <div className="rounded-xl border border-border/60 bg-muted/30 p-5">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Agents like Claude Code and Codex see nothing until you grant it here. Grants
          are enforced by the Journal MCP server on your computer, not by Homebase.{" "}
          <a
            href="https://github.com/2002Bishwajeet/journal/tree/main/mcp#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2 hover:text-foreground"
          >
            Set up the MCP server
          </a>
        </p>
      </div>

      <div className="space-y-6">
        <SectionHeader subtitle="Choose what agents can read or edit, per folder">
          Folders
        </SectionHeader>
        <div className="space-y-3">
          {isLoaded && folders.map((folder) => (
            <FolderAccessRow
              key={folder.id}
              folder={folder}
              grants={grants}
              onSetFolder={setFolder}
              onSetNote={setNote}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
