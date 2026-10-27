import { FolderOpen, Globe } from "lucide-react";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { Button } from "@/components/ui/button";
import type { Folder } from "@/types";

interface MoveToFolderDialogProps {
  isOpen: boolean;
  onClose: () => void;
  noteTitle: string;
  /** The folder the note is in now; left out of the list. */
  currentFolderId: string;
  folders: ReadonlyArray<Folder>;
  onMove: (folderId: string) => void;
}

/** Pick the folder to move a note to (#622). Shared folders are marked: the note becomes public there. */
export default function MoveToFolderDialog({
  isOpen,
  onClose,
  noteTitle,
  currentFolderId,
  folders,
  onMove,
}: MoveToFolderDialogProps) {
  const targets = folders.filter((f) => f.id !== currentFolderId);

  return (
    <ResponsiveSheet
      open={isOpen}
      onOpenChange={(open) => !open && onClose()}
      variant="bottom"
      title="Move to folder"
      description={<span className="block truncate">Choose a folder for "{noteTitle}".</span>}
      dialogClassName="sm:max-w-106.25"
    >
      {targets.length === 0 ? (
        <p className="py-4 text-sm text-muted-foreground">
          There are no other folders yet.
        </p>
      ) : (
        <ul aria-label="Folders" className="max-h-72 overflow-y-auto -mx-2 in-data-[slot=sheet-body]:max-h-none">
          {targets.map((folder) => (
            <li key={folder.id}>
              <Button
                variant="ghost"
                className="w-full justify-start h-10 px-2 pointer-coarse:h-12"
                onClick={() => {
                  onMove(folder.id);
                  onClose();
                }}
              >
                <FolderOpen className="mr-2 h-4 w-4 shrink-0" />
                <span className="truncate flex-1 text-left" title={folder.name}>
                  {folder.name}
                </span>
                {folder.isPublic && (
                  <span className="ml-2 flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <Globe aria-hidden className="h-3 w-3" />
                    Shared
                  </span>
                )}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </ResponsiveSheet>
  );
}
