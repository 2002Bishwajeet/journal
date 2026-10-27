import { useState } from "react";
import { Check, FolderOpen, FolderPlus, Globe } from "lucide-react";
import { useSheetMode } from "@/hooks/useSheetMode";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import CreateFolderModal from "@/components/modals/CreateFolderModal";
import type { Folder } from "@/types";

/** With more folders than this, the picker shows a search field. */
const SEARCH_THRESHOLD = 8;

interface MoveToFolderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  noteTitle: string;
  /** The folder the note is in now; listed, checked and disabled. */
  currentFolderId: string;
  folders: ReadonlyArray<Folder>;
  onMove: (folderId: string) => void;
  /** Make a folder and return its id; the note moves into it. */
  onCreateFolder: (name: string) => Promise<string>;
}

/** Pick the folder to move a note to (#622). Shared folders are marked: the note becomes public there. */
export default function MoveToFolderDialog({
  isOpen,
  onClose,
  noteTitle,
  currentFolderId,
  folders,
  onMove,
  onCreateFolder,
}: MoveToFolderDialogProps) {
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const needle = query.trim().toLowerCase();
  // The sheet shows where the note is now; the desktop dialog leaves that folder out.
  const asSheet = useSheetMode();
  const listed = asSheet ? folders : folders.filter((f) => f.id !== currentFolderId);
  const close = () => {
    setQuery("");
    onClose();
  };
  const shown = needle ? listed.filter((f) => f.name.toLowerCase().includes(needle)) : listed;

  return (
    <>
      <ResponsiveSheet
        open={isOpen}
        onOpenChange={(open) => !open && close()}
        variant="bottom"
        title={asSheet ? <span className="block truncate">Move "{noteTitle}"</span> : "Move to folder"}
        description={
          asSheet ? (
            <span className="sr-only">Move to folder. Choose a folder for "{noteTitle}".</span>
          ) : (
            <span className="block truncate">Choose a folder for "{noteTitle}".</span>
          )
        }
        dialogClassName="sm:max-w-106.25"
      >
        {asSheet && folders.length > SEARCH_THRESHOLD && (
          <Input
            type="search"
            aria-label="Search folders"
            placeholder="Search folders"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="mb-2 text-base"
          />
        )}
        <ul aria-label="Folders" className="max-h-72 overflow-y-auto -mx-2 in-data-[slot=sheet-body]:max-h-none">
          {asSheet && (
            <li>
              <Button
                variant="ghost"
                className="w-full justify-start h-10 px-2 pointer-coarse:h-13"
                onClick={() => setCreating(true)}
              >
                <FolderPlus aria-hidden className="mr-2 h-4 w-4 shrink-0" />
                New folder…
              </Button>
            </li>
          )}
          {!asSheet && listed.length === 0 && (
            <li className="py-4 px-2 text-sm text-muted-foreground">There are no other folders yet.</li>
          )}
          {shown.map((folder) => {
            const current = folder.id === currentFolderId;
            return (
              <li key={folder.id}>
                <Button
                  variant="ghost"
                  className="w-full justify-start h-auto min-h-10 px-2 py-1.5 pointer-coarse:min-h-13 aria-[current=true]:opacity-100"
                  disabled={current}
                  aria-current={current ? "true" : undefined}
                  aria-describedby={folder.isPublic ? `public-${folder.id}` : undefined}
                  onClick={() => {
                    onMove(folder.id);
                    close();
                  }}
                >
                  <FolderOpen aria-hidden className="mr-2 h-4 w-4 shrink-0" />
                  <span className="min-w-0 flex-1 truncate text-left" title={folder.name}>
                    {folder.name}
                  </span>
                  {folder.isPublic && (
                    <span className="ml-2 flex shrink-0 items-center gap-1 text-sm text-muted-foreground">
                      <Globe aria-hidden className="h-3.5 w-3.5" />
                      Shared
                    </span>
                  )}
                  {current && <Check aria-hidden className="ml-2 h-5 w-5 shrink-0 text-primary" />}
                </Button>
                {folder.isPublic && (
                  <p id={`public-${folder.id}`} className="-mt-1 mb-1 pl-8 text-xs text-muted-foreground">
                    Notes here are public
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </ResponsiveSheet>
      <CreateFolderModal
        isOpen={creating}
        onClose={() => setCreating(false)}
        onCreate={async (name) => {
          onMove(await onCreateFolder(name));
          close();
        }}
      />
    </>
  );
}
