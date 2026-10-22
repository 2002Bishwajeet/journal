import { useState } from "react";
import { Users, ExternalLink, Loader2, Check, Info } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useCircles } from "@/hooks/circles/useCircles";
import { useMissingPermissions } from "@/hooks/auth/useMissingPermissions";
import {
  JOURNAL_APP_ID,
  JOURNAL_APP_NAME,
  COLLABORATION_PERMISSIONS,
  CONTACT_TARGET_DRIVE_REQUEST,
} from "@/lib/homebase/config";
import { journalDriveRequest } from "@/hooks/auth/useYouAuthAuthorization";
import type { CircleDefinition } from "@homebase-id/js-lib/network";
import { CircleOption } from "@/components/circles/CircleOption";
import { useNoteCollaboration, type SelectedCircle } from "@/hooks/useNoteCollaboration";

interface MarkCollaborativeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  noteId: string;
  noteTitle: string;
  onSuccess?: () => void;
}

export function MarkCollaborativeDialog({
  isOpen,
  onClose,
  noteId,
  noteTitle,
  onSuccess,
}: MarkCollaborativeDialogProps) {
  const { share } = useNoteCollaboration();
  const { fetch: circlesFetch } = useCircles(true);
  const [selectedCircles, setSelectedCircles] = useState<SelectedCircle[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Build return URL with noteId for reopening dialog after permission grant
  const returnUrl = `${window.location.origin}${window.location.pathname}?action=collaborate&noteId=${noteId}`;

  // Check for missing permissions with custom return URL
  const extendPermissionUrl = useMissingPermissions({
    appId: JOURNAL_APP_ID,
    drives: [journalDriveRequest, CONTACT_TARGET_DRIVE_REQUEST],
    permissions: COLLABORATION_PERMISSIONS,
    circleDrives: [journalDriveRequest, CONTACT_TARGET_DRIVE_REQUEST],
    needsAllConnected: false,
    returnUrl,
  });

  const hasMissingPermissions = !!extendPermissionUrl;
  const circles = (circlesFetch.data || []).filter(
    (c): c is CircleDefinition & { id: string } => !!c.id,
  );
  const isLoading = circlesFetch.isLoading;

  function handleCircleSelect(circle: CircleDefinition & { id: string }) {
    setSelectedCircles((prev) => {
      const existing = prev.find((c) => c.circleId === circle.id);
      if (existing) {
        // Deselect
        return prev.filter((c) => c.circleId !== circle.id);
      } else {
        // Select with members
        return [...prev, { circleId: circle.id, name: circle.name }];
      }
    });
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    const shared = await share(noteId, selectedCircles);
    setIsSubmitting(false);
    if (shared) {
      onSuccess?.();
      onClose();
    }
  }

  const selectedCircleIdSet = new Set(selectedCircles.map((c) => c.circleId));

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        // When Radix requests a close (Escape key or overlay click), call onClose
        // unless a submit is in progress — ignore the request in that case to
        // avoid a confusing half-submitted state.
        if (!open && !isSubmitting) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mx-auto bg-collaborative/10 p-3 rounded-full mb-4 w-fit">
            <Users className="h-6 w-6 text-collaborative" />
          </div>
          <DialogTitle className="text-center text-xl">
            Mark as Collaborative
          </DialogTitle>
          <DialogDescription className="text-center pt-2">
            Share "{noteTitle || "Untitled"}" with selected circles
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {hasMissingPermissions ? (
            <div className="space-y-4">
              <Alert>
                <Info className="h-4 w-4" />
                <AlertDescription>
                  {JOURNAL_APP_NAME} needs additional permissions to enable
                  collaboration.
                </AlertDescription>
              </Alert>

              <Button asChild className="w-full" size="lg">
                <a
                  href={extendPermissionUrl}
                  aria-label="Grant Permissions in Homebase (opens Homebase)"
                  className="flex items-center gap-2"
                >
                  Grant Permissions <ExternalLink className="h-4 w-4" />
                </a>
              </Button>
            </div>
          ) : (
            <>
              {/* Circle Info */}
              <Alert>
                <Users className="h-4 w-4" />
                <AlertDescription>
                  Members of selected circles will be able to view and edit this
                  note.
                </AlertDescription>
              </Alert>

              {/* Circle Selection */}
              <div className="space-y-2">
                <Label className="text-sm font-medium">Select Circles</Label>
                <p className="text-xs text-muted-foreground">Circles are groups of people you're connected with on Homebase.</p>

                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : circles.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    No circles available. Create circles in your Homebase settings.
                  </div>
                ) : (
                  <ScrollArea className="h-56 rounded-md border p-2">
                    <div className="space-y-2">
                      {circles.map((circle) => (
                        <CircleOption
                          key={circle.id}
                          circle={circle}
                          isActive={selectedCircleIdSet.has(circle.id)}
                          onSelect={() => handleCircleSelect(circle)}
                        />
                      ))}
                    </div>
                  </ScrollArea>
                )}
              </div>

              {/* Actions */}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={onClose}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleSubmit}
                  disabled={isSubmitting || selectedCircles.length === 0}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sharing...
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      Share with {selectedCircles.length || 0} circle
                      {selectedCircles.length !== 1 ? "s" : ""}
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
