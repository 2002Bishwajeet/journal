import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useJournalPermissions } from "@/hooks/auth/useJournalPermissions";
import { ExternalLink, ShieldCheck } from "lucide-react";

export const ExtendPermissionDialog = () => {
  const permissions = useJournalPermissions();

  if (!permissions || permissions.isDismissed) return null;

  const count = permissions.items.length;
  const noun = count === 1 ? "permission" : "permissions";

  return (
    <Dialog open onOpenChange={(open) => !open && permissions.dismiss()}>
      <DialogContent
        showCloseButton={false}
        className="gap-5 sm:max-w-md"
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
          <Button variant="ghost" size="lg" className="w-full max-sm:h-11" onClick={permissions.dismiss}>
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
