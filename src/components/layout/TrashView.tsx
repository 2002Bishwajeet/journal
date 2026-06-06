import { memo } from "react";
import { ArchiveRestore, Trash2, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { NoteListEntry } from "@/types";

interface TrashViewProps {
  notes: NoteListEntry[];
  isLoading?: boolean;
  onRestore: (id: string) => void;
  onDeleteForever: (id: string) => void;
  onEmptyTrash: () => void;
  className?: string;
}

function TrashViewComponent({
  notes,
  isLoading,
  onRestore,
  onDeleteForever,
  onEmptyTrash,
  className,
}: TrashViewProps) {
  return (
    <div className={cn("flex flex-col h-full w-full min-w-0", className)}>
      <div className="flex items-center justify-between h-12 px-3 border-b border-border shrink-0">
        <span className="text-sm font-medium">Trash</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-destructive hover:text-destructive"
          onClick={onEmptyTrash}
          disabled={notes.length === 0}
        >
          Empty Trash
        </Button>
      </div>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
          Loading…
        </div>
      ) : notes.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground p-6 text-center">
          <Trash2 className="h-8 w-8 opacity-40" />
          <p className="text-sm">Trash is empty</p>
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <ul>
            {notes.map((note) => (
              <li
                key={note.docId}
                className="flex items-start gap-2 px-3 py-3 border-b border-border/50"
              >
                <FileText className="h-4 w-4 mt-0.5 text-muted-foreground/60 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{note.title || "Untitled"}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {note.preview || "No content"}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Restore note"
                    className="h-7 w-7"
                    onClick={() => onRestore(note.docId)}
                  >
                    <ArchiveRestore className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Delete forever"
                    className="h-7 w-7 text-destructive hover:text-destructive"
                    onClick={() => onDeleteForever(note.docId)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}

export const TrashView = memo(TrashViewComponent);
