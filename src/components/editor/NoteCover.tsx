/**
 * Full-width cover image above the note title.
 *
 * The owner can add, change, reposition (vertical drag) and remove it; a note
 * shared with you shows its cover read-only. Repositioning keeps the live
 * position in local state and writes the Yjs doc once per drag, on pointerup.
 */

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent } from "react";
import { ImagePlus, Move, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { OdinImage } from "@/components/OdinImage/OdinImage";
import { useDotYouClientContext } from "@/components/auth";
import { useAuth } from "@/hooks/auth";
import { useDeviceType } from "@/hooks/useDeviceType";
import { JOURNAL_DRIVE } from "@/lib/homebase/config";
import { coverPayloadKey, dragToPositionY } from "@/lib/editor/cover";
import { cn } from "@/lib/utils";
import type { DocumentMetadata } from "@/types";
import { useEditorContext } from "./EditorContext";

export function NoteCover({ metadata }: { metadata: DocumentMetadata }) {
  const { cover, setCoverFromFile, removeCover, setCoverPosition } = useEditorContext();
  const { getIdentity } = useAuth();
  const dotYouClient = useDotYouClientContext();
  const isTouch = useDeviceType() !== "desktop";
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [repositioning, setRepositioning] = useState(false);
  // Position shown while a drag is in progress; null otherwise.
  const [dragY, setDragY] = useState<number | null>(null);
  const dragStart = useRef<{ clientY: number; positionY: number } | null>(null);

  const isPeerNote = !!metadata.authorOdinId && metadata.authorOdinId !== getIdentity();

  useEffect(() => {
    if (!repositioning) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      dragStart.current = null;
      setDragY(null);
      setRepositioning(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [repositioning]);

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires a change.
    e.target.value = "";
    if (!file) return;
    setCoverFromFile(file).catch((err: Error) => toast.error(err.message));
  };

  const fileInput = (
    <input
      ref={fileInputRef}
      type="file"
      accept="image/*"
      className="hidden"
      aria-label="Choose cover image"
      onChange={onFileChange}
    />
  );

  if (!cover) {
    if (isPeerNote) return null;
    return (
      <div className="px-4 pt-3">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Add cover"
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "text-xs text-muted-foreground transition-opacity duration-200",
            !isTouch && "opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100",
          )}
        >
          <ImagePlus />
          Add cover
        </Button>
        {fileInput}
      </div>
    );
  }

  const positionY = dragY ?? cover.positionY;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!repositioning || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { clientY: e.clientY, positionY: cover.positionY };
    setDragY(cover.positionY);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    setDragY(dragToPositionY(start.positionY, e.clientY - start.clientY, e.currentTarget.clientHeight));
  };
  const onPointerUp = () => {
    if (!dragStart.current) return;
    dragStart.current = null;
    if (dragY !== null && dragY !== cover.positionY) setCoverPosition(dragY);
    setDragY(null);
  };
  const onPointerCancel = () => {
    dragStart.current = null;
    setDragY(null);
  };

  const fileId = cover.src.slice("attachment://".length).split("/")[0];
  const payloadKey = coverPayloadKey(cover.src);

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      className={cn(
        "group relative h-40 w-full overflow-hidden bg-muted sm:h-56",
        repositioning && "cursor-grab touch-none select-none active:cursor-grabbing",
      )}
    >
      {/* OdinImage styles its own <img>s, so the focal point reaches them through a CSS variable. */}
      <div
        role="img"
        aria-label="Note cover"
        style={{ "--cover-y": `${positionY}%` } as CSSProperties}
        className="pointer-events-none absolute inset-0 [&_img]:[object-position:50%_var(--cover-y)]"
      >
        {payloadKey ? (
          <OdinImage
            key={cover.src}
            dotYouClient={dotYouClient}
            odinId={isPeerNote ? metadata.authorOdinId : undefined}
            targetDrive={JOURNAL_DRIVE}
            fileId={fileId}
            fileKey={payloadKey}
            alt=""
            fit="cover"
            className="h-full w-full"
          />
        ) : (
          <img
            src={cover.src}
            alt=""
            className="h-full w-full object-cover"
            style={{ objectPosition: `50% ${positionY}%` }}
          />
        )}
      </div>

      {repositioning && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded bg-black/60 px-2 py-1 text-xs text-white">Drag to reposition</span>
        </div>
      )}

      {!isPeerNote && (
        <div
          className={cn(
            "absolute bottom-2 right-2 flex gap-1 transition-opacity duration-200",
            repositioning || isTouch
              ? "opacity-100"
              : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
          )}
        >
          {repositioning ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label="Done repositioning"
              className="text-xs"
              onClick={() => setRepositioning(false)}
            >
              Done
            </Button>
          ) : (
            <>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label="Change cover"
                className="text-xs"
                onClick={() => fileInputRef.current?.click()}
              >
                <ImagePlus />
                Change cover
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label="Reposition cover"
                className="text-xs"
                onClick={() => setRepositioning(true)}
              >
                <Move />
                Reposition
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                aria-label="Remove cover"
                className="text-xs"
                onClick={() => void removeCover()}
              >
                <Trash2 />
                Remove
              </Button>
            </>
          )}
          {fileInput}
        </div>
      )}
    </div>
  );
}
