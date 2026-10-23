import { useState } from "react";
import { Users, ExternalLink, Loader2, Check, Info, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";

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
import { useNoteCollaboration } from "@/hooks/useNoteCollaboration";
import { usePersonSharingSupported } from "@/hooks/usePersonSharingSupported";
import { useDotYouClientContext } from "@/components/auth";
import { isOdinId, normalizeOdinId } from "@/lib/homebase/shareTargets";

interface MarkCollaborativeDialogProps {
  isOpen: boolean;
  onClose: () => void;
  noteId: string;
  noteTitle: string;
  /** Who the note is shared with now, for changing an existing share (#681). */
  circleIds?: string[];
  odinIds?: string[];
  onSuccess?: () => void;
}

const plural = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;

export function MarkCollaborativeDialog({
  isOpen,
  onClose,
  noteId,
  noteTitle,
  circleIds: sharedCircleIds = [],
  odinIds: sharedOdinIds = [],
  onSuccess,
}: MarkCollaborativeDialogProps) {
  const { share } = useNoteCollaboration();
  const { fetch: circlesFetch } = useCircles(true);
  const owner = useDotYouClientContext().getHostIdentity();
  const personSharing = usePersonSharingSupported();
  const [selectedCircleIds, setSelectedCircleIds] = useState(sharedCircleIds);
  const [odinIds, setOdinIds] = useState(sharedOdinIds);
  const [person, setPerson] = useState("");
  const [personError, setPersonError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const wasShared = sharedCircleIds.length > 0 || sharedOdinIds.length > 0;

  // Build return URL with noteId for reopening dialog after permission grant
  const returnUrl = `${window.location.origin}${window.location.pathname}?action=collaborate&noteId=${noteId}`;

  // Check for missing permissions with custom return URL
  const extendPermissionUrl = useMissingPermissions({
    appId: JOURNAL_APP_ID,
    drives: [journalDriveRequest, CONTACT_TARGET_DRIVE_REQUEST],
    permissions: COLLABORATION_PERMISSIONS,
    circleDrives: [journalDriveRequest, CONTACT_TARGET_DRIVE_REQUEST],
    // Every connection gets drive access, and each file's ACL decides who reads it, so
    // a person named on a share who is in no circle can open it (#678 decision 6)
    needsAllConnected: true,
    returnUrl,
  });

  const hasMissingPermissions = !!extendPermissionUrl;
  const circles = (circlesFetch.data || []).filter(
    (c): c is CircleDefinition & { id: string } => !!c.id,
  );
  const isLoading = circlesFetch.isLoading;

  function handleCircleSelect(circle: CircleDefinition & { id: string }) {
    setSelectedCircleIds((prev) =>
      prev.includes(circle.id)
        ? prev.filter((id) => id !== circle.id)
        : [...prev, circle.id],
    );
  }

  function addPerson() {
    const odinId = normalizeOdinId(person);
    const error = !isOdinId(odinId)
      ? "Type a Homebase identity, such as name.example.com"
      : odinId === owner
        ? "You can't share a note with yourself"
        : odinIds.includes(odinId)
          ? `${odinId} is already added`
          : null;
    setPersonError(error);
    if (error) return;
    setOdinIds((prev) => [...prev, odinId]);
    setPerson("");
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    const shared = await share(noteId, {
      circles: selectedCircleIds.map((circleId) => ({
        circleId,
        name: circles.find((c) => c.id === circleId)?.name ?? circleId,
      })),
      odinIds,
    });
    setIsSubmitting(false);
    if (shared) {
      onSuccess?.();
      onClose();
    }
  }

  const selectedCircleIdSet = new Set(selectedCircleIds);
  const nothingSelected = selectedCircleIds.length === 0 && odinIds.length === 0;
  const shareLabel = nothingSelected
    ? wasShared
      ? "Stop sharing"
      : "Share with 0 circles"
    : `Share with ${[
        selectedCircleIds.length > 0 && plural(selectedCircleIds.length, "circle", "circles"),
        odinIds.length > 0 && plural(odinIds.length, "person", "people"),
      ]
        .filter(Boolean)
        .join(" and ")}`;

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
            Share "{noteTitle || "Untitled"}" with circles or people
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
                  Members of selected circles and the people you add will be
                  able to view and edit this note.
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

              {/* People, by identity. #682 replaces this with the real picker. */}
              {personSharing && (
                <div className="space-y-2">
                  <Label htmlFor="share-person" className="text-sm font-medium">
                    Add a person (Homebase identity)
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="share-person"
                      value={person}
                      onChange={(e) => setPerson(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addPerson();
                        }
                      }}
                      placeholder="name.example.com"
                      autoComplete="off"
                      autoCapitalize="none"
                      spellCheck={false}
                      aria-invalid={!!personError}
                      aria-describedby={personError ? "share-person-error" : undefined}
                    />
                    <Button type="button" variant="outline" onClick={addPerson}>
                      Add
                    </Button>
                  </div>
                  {personError && (
                    <p id="share-person-error" role="alert" className="text-xs text-destructive">
                      {personError}
                    </p>
                  )}
                  {odinIds.length > 0 && (
                    <ul aria-label="People" className="space-y-1">
                      {odinIds.map((odinId) => (
                        <li
                          key={odinId}
                          className="flex items-center justify-between gap-2 rounded-md border px-3 py-1 text-sm"
                        >
                          <span className="truncate">{odinId}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            aria-label={`Remove ${odinId}`}
                            onClick={() => setOdinIds((prev) => prev.filter((id) => id !== odinId))}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}

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
                  disabled={isSubmitting || (nothingSelected && !wasShared)}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sharing...
                    </>
                  ) : (
                    <>
                      <Check className="mr-2 h-4 w-4" />
                      {shareLabel}
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
