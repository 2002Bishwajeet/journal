import { useEffect } from "react";
import { Plus } from "lucide-react";

/**
 * Phone only (#878): a round New note button at the bottom right. While it is on
 * screen, html[data-fab] sets --fab-clearance so lists and toasts keep clear of it.
 */
export function NewNoteFab({ onClick }: { onClick: () => void }) {
  useEffect(() => {
    document.documentElement.dataset.fab = "";
    return () => {
      delete document.documentElement.dataset.fab;
    };
  }, []);

  return (
    <button
      type="button"
      aria-label="New note"
      onClick={onClick}
      className="new-note-fab fixed z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground outline-none select-none [-webkit-tap-highlight-color:transparent] focus-visible:ring-[3px] focus-visible:ring-ring/50"
    >
      <Plus className="size-6" strokeWidth={2.25} aria-hidden />
    </button>
  );
}
