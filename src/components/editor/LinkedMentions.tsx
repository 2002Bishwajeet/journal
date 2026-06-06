/**
 * "Linked mentions" (backlinks) panel shown at the bottom of a note — the active
 * notes that link to this one via `[[`. Reactive: backed by a PGlite live query,
 * so new/removed links appear without a refresh. Hidden when there are none.
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, ChevronRight, Link2 } from "lucide-react";
import { useBacklinks } from "@/hooks/useNotes";
import { cn } from "@/lib/utils";

export function LinkedMentions({ noteId }: { noteId: string }) {
  const { data: backlinks } = useBacklinks(noteId);
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  if (backlinks.length === 0) return null;

  return (
    <section className="mt-8 border-t border-border pt-4">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        {open ? (
          <ChevronDown className="h-4 w-4" />
        ) : (
          <ChevronRight className="h-4 w-4" />
        )}
        <Link2 className="h-4 w-4" />
        <span>Linked mentions ({backlinks.length})</span>
      </button>

      {open && (
        <ul className="mt-2 space-y-1">
          {backlinks.map((note) => (
            <li key={note.docId}>
              <button
                type="button"
                onClick={() =>
                  navigate(`/${note.metadata.folderId}/${note.docId}`, {
                    viewTransition: true,
                  })
                }
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left",
                  "hover:bg-muted/50 transition-colors",
                )}
              >
                <span className="text-sm font-medium truncate w-full">
                  {note.title || "Untitled"}
                </span>
                {note.preview && (
                  <span className="text-xs text-muted-foreground line-clamp-1 w-full">
                    {note.preview}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
