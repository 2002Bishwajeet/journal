import { useState } from "react";
import { ChevronRight } from "lucide-react";
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
import { cn } from "@/lib/utils";
import { SectionHeader } from "../SectionHeader";

const selectClass =
  "min-h-11 md:min-h-0 rounded-md border border-border bg-background text-foreground text-sm px-2 py-1.5 shrink-0 disabled:opacity-60 disabled:cursor-not-allowed";

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
    <div className="border-b last:border-b-0">
      <div className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => setIsOpen((v) => !v)}
            className="flex shrink-0 min-h-11 md:min-h-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className={cn("h-3.5 w-3.5", isOpen && "rotate-90")} aria-hidden="true" />
            Notes
          </button>
          <Label className="truncate text-sm leading-5 font-medium">{folder.name}</Label>
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
    <div className="space-y-3 border-t bg-muted/30 px-4 py-3">
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
          <p className="text-xs leading-relaxed text-muted-foreground">
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
      <div className="rounded-xl border bg-muted/30 px-4 py-3.5">
        <p className="text-sm leading-relaxed text-muted-foreground text-pretty">
          Agents like Claude Code and Codex see nothing until you grant it here. Grants
          are enforced by the Journal MCP server on your computer, not by Homebase.{" "}
          <a
            href="https://github.com/2002Bishwajeet/journal/tree/main/mcp#readme"
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground underline decoration-muted-foreground/70 underline-offset-4 hover:decoration-current"
          >
            Set up the MCP server
          </a>
        </p>
      </div>

      <div className="space-y-4">
        <SectionHeader subtitle="Choose what agents can read or edit, per folder">
          Folders
        </SectionHeader>
        {isLoaded && (
          <div className="overflow-hidden rounded-xl border bg-card">
            {folders.map((folder) => (
              <FolderAccessRow
                key={folder.id}
                folder={folder}
                grants={grants}
                onSetFolder={setFolder}
                onSetNote={setNote}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
