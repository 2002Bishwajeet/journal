
import { type TargetDriveAccessRequest } from "@homebase-id/js-lib/auth";
import { type AppPermissionType } from "@homebase-id/js-lib/network";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useMissingPermissions } from "@/hooks/auth/useMissingPermissions";
import { ExternalLink, ShieldAlert } from "lucide-react";


interface ExtendPermissionDialogProps {
  appId: string;
  appName: string;
  drives: TargetDriveAccessRequest[];
  circleDrives?: TargetDriveAccessRequest[];
  permissions: AppPermissionType[];
  needsAllConnected?: boolean;
}

export const ExtendPermissionDialog = ({
  appId,
  appName,
  drives,
  circleDrives,
  permissions,
  needsAllConnected,
}: ExtendPermissionDialogProps) => {
  const extendPermissionUrl = useMissingPermissions({
    appId,
    drives,
    circleDrives,
    permissions,
    needsAllConnected,
  });

  if (!extendPermissionUrl) return null;

  return (
    <Dialog open={!!extendPermissionUrl} onOpenChange={() => {}}>
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto bg-secondary p-3 rounded-full mb-4 w-fit">
             <ShieldAlert className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle className="text-center text-xl">Missing permissions</DialogTitle>
          <DialogDescription className="text-center pt-2">
            The {appName} app is missing permissions. Without the necessary permissions the functionality of {appName} will be limited.
          </DialogDescription>
        </DialogHeader>
        
        <div className="text-muted-foreground text-sm text-center px-4 pb-4">
           This can happen when the app adds new features that require additional permissions or if permissions were revoked manually.
        </div>

        <div className="flex justify-center mt-2">
          <Button asChild className="w-full sm:w-auto min-w-[200px]" size="lg">
            <a href={extendPermissionUrl} className="flex items-center gap-2">
              Extend permissions <ExternalLink className="h-4 w-4" />
            </a>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
