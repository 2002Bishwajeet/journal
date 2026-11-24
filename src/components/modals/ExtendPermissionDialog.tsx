import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useJournalPermissions } from "@/hooks/auth/useJournalPermissions";
import { ExternalLink, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

interface ExtendPermissionDialogProps {
  /** A screen that needs the grant to go on (a share link, #1494): shown even after "Not now", which calls this instead. */
  onNotNow?: () => void;
  /** Shown instead when there is nothing to grant, or the permissions could not be read. */
  fallback?: ReactNode;
}

export const ExtendPermissionDialog = ({ onNotNow, fallback = null }: ExtendPermissionDialogProps = {}) => {
  const permissions = useJournalPermissions();

  if (!permissions || (!onNotNow && permissions.isDismissed)) return fallback;

  const count = permissions.items.length;
  const noun = count === 1 ? "permission" : "permissions";
  const dismiss = onNotNow ?? permissions.dismiss;

  return (
    <Dialog open onOpenChange={(open) => !open && dismiss()}>
      <DialogContent
        showCloseButton={false}
        className="sm:max-w-md"
        // Radix skips links and would ring "Not now" on open; focus the dialog itself instead.
        // A stray backdrop tap must not save a dismissal; Escape and "Not now" still do.
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLElement).focus();
        }}
      >
        <DialogHeader className="text-left sm:text-left">
          <div className="mb-1 w-fit rounded-full bg-secondary p-2.5">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <DialogTitle className="text-xl leading-tight text-balance">
            Journal needs {count} {noun}
          </DialogTitle>
          <DialogDescription className="text-pretty">
            Journal doesn't have some access it needs. Some features won't work until you grant {count === 1 ? "it" : "them"}.
          </DialogDescription>
        </DialogHeader>

        <ul className="space-y-2" aria-label={`Missing ${noun}`}>
          {permissions.items.map((item) => (
            <li key={item.id} className="rounded-lg bg-muted/60 px-3 py-2.5 text-left">
              <p className="text-sm font-medium">{item.label}</p>
              <p className="text-sm text-muted-foreground text-pretty">{item.reason}</p>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2">
          <Button asChild size="lg" className="w-full max-sm:h-11">
            <a href={permissions.url} onClick={permissions.onGrant}>
              Grant {noun} <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </a>
          </Button>
          <Button variant="ghost" size="lg" className="w-full max-sm:h-11" onClick={dismiss}>
            Not now
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            You can grant {count === 1 ? "it" : "them"} later in Settings, under Account.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
};
