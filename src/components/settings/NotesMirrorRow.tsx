import { toast } from "sonner";
import { FolderOpen, FolderSync } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNotesMirrorSettings } from "@/hooks/useNotesMirror";
import { SectionHeader } from "./SectionHeader";

/** Desktop app: pick a folder that always holds a .md copy of every note (#1015). */
export function NotesMirrorRow() {
  const { available, root, choose, disable, openFolder } =
    useNotesMirrorSettings();
  if (!available || root === undefined) return null;

  const run = (action: () => Promise<void>, failure: string) => () =>
    action().catch((err: unknown) => {
      console.error("[NotesMirrorRow]", err);
      toast.error(failure);
    });

  return (
    <div className="space-y-4">
      <SectionHeader subtitle="Keep a Markdown copy of every note in a folder on this computer, updated as you write. Changes go one way: edits to the files are not read back.">
        Mirror notes to a folder
      </SectionHeader>
      {root === null ? (
        <Button
          variant="outline"
          className="w-full h-11 sm:w-auto md:h-9"
          onClick={run(choose, "Couldn't start the mirror")}
        >
          <FolderSync />
          Choose folder
        </Button>
      ) : (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed wrap-anywhere">
            <span className="text-muted-foreground">Mirroring to </span>
            <span className="font-medium">{root}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              className="h-11 md:h-9"
              onClick={run(openFolder, "Couldn't open the folder")}
            >
              <FolderOpen />
              Open folder
            </Button>
            <Button
              variant="outline"
              className="h-11 md:h-9"
              onClick={run(choose, "Couldn't change the folder")}
            >
              Change folder
            </Button>
            <Button
              variant="outline"
              className="h-11 md:h-9"
              onClick={run(disable, "Couldn't turn the mirror off")}
            >
              Turn off
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
