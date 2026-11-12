import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useCanEdit } from "@/hooks/useCanEdit";
import { openSettings } from "@/hooks/useSettingsOpener";
import { openPaywall } from "@/lib/billing";

/** Top of the note list and the editor once the native trial ends (#1176). Never on the web. */
export function ReadOnlyBanner() {
  const canEdit = useCanEdit();
  if (canEdit) return null;
  return (
    <div role="status" className="flex items-center gap-2 border-b bg-card px-4 py-2">
      <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground text-pretty">
        Your notes are read-only on this device. Unlock Journal to keep writing.
      </p>
      <Button size="sm" className="min-h-11 shrink-0 md:min-h-8" onClick={openPaywall}>
        Unlock
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon" className="size-11 shrink-0 text-muted-foreground md:size-8" aria-label="More">
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onSelect={() => openSettings("data")}>Export my notes</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
