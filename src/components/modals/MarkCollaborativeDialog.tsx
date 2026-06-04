import { useState, useCallback } from "react";
import { useSyncService } from "@/hooks";
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
import { useDotYouClientContext } from "@/components/auth";
import { useCircles } from "@/hooks/circles/useCircles";
import { useMissingPermissions } from "@/hooks/auth/useMissingPermissions";
import { NotesDriveProvider } from "@/lib/homebase/NotesDriveProvider";
import {
  JOURNAL_APP_ID,
  JOURNAL_APP_NAME,
  COLLABORATION_PERMISSIONS,
  COLLABORATIVE_FOLDER_ID,
  CONTACT_TARGET_DRIVE_REQUEST,
} from "@/lib/homebase/config";
import { journalDriveRequest } from "@/hooks/auth/useYouAuthAuthorization";
import { toast } from "sonner";
import type { CircleDefinition } from "@homebase-id/js-lib/network";
import { CircleOption } from "@/components/circles/CircleOption";
import { useNotes } from "@/hooks/useNotes";

interface MarkCollaborativeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  noteId: string;
  noteTitle: string;
  onSuccess?: () => void;
}

interface SelectedCircle {
  circleId: string;
  members: string[];
}

export function MarkCollaborativeDialog({
  isOpen,
  onClose,
  noteId,
  noteTitle,
  onSuccess,
}: MarkCollaborativeDialogProps) {
  const dotYouClient = useDotYouClientContext();
  const { syncService } = useSyncService();
  const {
    get: { data: notes = [] },
    updateNote: { mutateAsync: updateNoteMetadata },
  } = useNotes();
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
  const circles: CircleDefinition[] = circlesFetch.data || [];
  const isLoading = circlesFetch.isLoading;

  const handleCircleSelect = useCallback(
    (circle: CircleDefinition, members: string[]) => {
      setSelectedCircles((prev) => {
        const existing = prev.find((c) => c.circleId === circle.id);
        if (existing) {
          // Deselect
          return prev.filter((c) => c.circleId !== circle.id);
        } else {
          // Select with members
          return [...prev, { circleId: circle.id!, members }];
        }
      });
    },
    [],
  );

  const handleSubmit = useCallback(async () => {
    if (selectedCircles.length === 0) {
      toast.error("Please select at least one circle");
      return;
    }

    if (!dotYouClient) {
      toast.error("Not authenticated");
      return;
    }

    setIsSubmitting(true);
    try {
      // Extract circleIds and unique recipients from selected circles
      const circleIds = selectedCircles.map((c) => c.circleId);
      const allMembers = selectedCircles.flatMap((c) => c.members);
      const recipients = [...new Set(allMembers)].filter(Boolean);

      const provider = new NotesDriveProvider(dotYouClient);
      const editorOdinId = dotYouClient.getHostIdentity() || "";

      // Ensure the note body is on the server BEFORE we send the invite, so
      // recipients bootstrap real content instead of an empty note.
      if (syncService) {
        await syncService.flushAndSyncNote(noteId);
      }

      await provider.makeNoteCollaborative(
        noteId,
        circleIds,
        recipients,
        editorOdinId,
      );

      const existingNote = notes.find((n) => n.docId === noteId);
      if (existingNote) {
        await updateNoteMetadata({
          docId: noteId,
          metadata: {
            ...existingNote.metadata,
            folderId: COLLABORATIVE_FOLDER_ID,
            isCollaborative: true,
            circleIds,
            recipients,
            lastEditedBy: editorOdinId,
          },
        });
      } else {
        console.warn(
          "[MarkCollaborative] Note not found locally, remote ACL updated but local state may be stale",
        );
      }

      toast.success("Note is now collaborative");
      onSuccess?.();
      onClose();
    } catch (err) {
      console.error("Failed to make note collaborative:", err);
      toast.error("Failed to make note collaborative");
    } finally {
      setIsSubmitting(false);
    }
  }, [
    dotYouClient,
    noteId,
    selectedCircles,
    onClose,
    onSuccess,
    notes,
    updateNoteMetadata,
    syncService,
  ]);

  const selectedCircleIdSet = new Set(selectedCircles.map((c) => c.circleId));

  return (
    <Dialog
      open={isOpen}
      //   onOpenChange={(open) => {
      //     if (open) {
      //       queryClient.invalidateQueries({
      //         queryKey: ["security-context"],
      //       });
      //     } else {
      //       setSelectedCircles([]);
      //       onClose();
      //     }
      //   }}
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
                  onClick={() => {
                    try {
                      localStorage.setItem(
                        "pendingCollaborativeNoteId",
                        noteId,
                      );
                    } catch {
                      /* private browsing */
                    }
                  }}
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

                {isLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : circles.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    No circles available. Create circles in your owner console.
                  </div>
                ) : (
                  <ScrollArea className="h-56 rounded-md border p-2">
                    <div className="space-y-2">
                      {circles.map((circle) => (
                        <CircleOption
                          key={circle.id}
                          circle={circle}
                          isActive={selectedCircleIdSet.has(circle.id!)}
                          onSelect={handleCircleSelect}
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
