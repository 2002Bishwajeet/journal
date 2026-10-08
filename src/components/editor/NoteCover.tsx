/**
 * Full-width cover image above the note title.
 *
 * The owner can add, change, reposition (vertical drag) and remove it; a note
 * shared with you shows its cover read-only. Repositioning keeps the live
 * position in local state and writes the Yjs doc once per drag, on pointerup.
 *
 * A note can also have a dark-mode cover (#512), shown instead while the app's
 * theme is dark. While one cover is being repositioned, that cover is shown.
 */

import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties, type PointerEvent } from "react";
import { ImagePlus, Moon, Move, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { OdinImage } from "@/components/OdinImage/OdinImage";
import { useDotYouClientContext } from "@/components/auth";
import { useAuth } from "@/hooks/auth";
import { useDeviceType } from "@/hooks/useDeviceType";
import { useIsDarkTheme } from "@/hooks/useIsDarkTheme";
import { JOURNAL_DRIVE } from "@/lib/homebase/config";
import {
  coverPayloadKey,
  dragToPositionY,
  isBelowMinCoverSize,
  type CoverVariant,
} from "@/lib/editor/cover";
import { cn } from "@/lib/utils";
import type { DocumentMetadata } from "@/types";
import { useEditorContext } from "./EditorContext";

/** A non-blocking hint when a picked cover is under the 1200×630 minimum; unreadable files are skipped. */
async function hintIfSmall(file: File) {
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return;
  const { width, height } = bitmap;
  bitmap.close();
  if (isBelowMinCoverSize(width, height)) {
    toast.info(`This image is ${width}×${height}. Covers look best at 2400×1260 or larger.`);
  }
}

export function NoteCover({ metadata }: { metadata: DocumentMetadata }) {
  const { cover, setCoverFromFile, removeCover, setCoverPosition } = useEditorContext();
  const { getIdentity } = useAuth();
  const dotYouClient = useDotYouClientContext();
  const isTouch = useDeviceType() !== "desktop";
  const isDark = useIsDarkTheme();
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Which cover the next picked file is for.
  const pickingFor = useRef<CoverVariant>("light");
  // The cover being repositioned, or null.
  const [repositioning, setRepositioning] = useState<CoverVariant | null>(null);
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
      setRepositioning(null);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [repositioning]);

  const pickFile = (variant: CoverVariant) => {
    pickingFor.current = variant;
    fileInputRef.current?.click();
  };

  const onFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again still fires a change.
    e.target.value = "";
    if (!file) return;
    setCoverFromFile(file, pickingFor.current)
      .then(() => hintIfSmall(file))
      .catch((err: Error) => toast.error(err.message));
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
          onClick={() => pickFile("light")}
          className={cn(
            "text-xs text-muted-foreground transition-opacity duration-200",
            !isTouch && "opacity-0 focus-visible:opacity-100 group-hover/header:opacity-100",
          )}
        >
          <ImagePlus />
          Add cover
          <span className="text-muted-foreground/70">· Best at 2400×1260 or larger</span>
        </Button>
        {fileInput}
      </div>
    );
  }

  const shownVariant: CoverVariant = repositioning ?? (isDark && cover.dark ? "dark" : "light");
  const shown = shownVariant === "dark" && cover.dark ? cover.dark : cover;
  const positionY = dragY ?? shown.positionY;

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (!repositioning || (e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    dragStart.current = { clientY: e.clientY, positionY: shown.positionY };
    setDragY(shown.positionY);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const start = dragStart.current;
    if (!start) return;
    setDragY(dragToPositionY(start.positionY, e.clientY - start.clientY, e.currentTarget.clientHeight));
  };
  const onPointerUp = () => {
    if (!dragStart.current) return;
    dragStart.current = null;
    if (dragY !== null && dragY !== shown.positionY) setCoverPosition(dragY, shownVariant);
    setDragY(null);
  };
  const onPointerCancel = () => {
    dragStart.current = null;
    setDragY(null);
  };

  const fileId = shown.src.slice("attachment://".length).split("/")[0];
  const payloadKey = coverPayloadKey(shown.src);

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
            key={shown.src}
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
            src={shown.src}
            alt=""
            className="h-full w-full object-cover"
            style={{ objectPosition: `50% ${positionY}%` }}
          />
        )}
      </div>

      {repositioning && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <span className="rounded bg-black/60 px-2 py-1 text-xs text-white">
            {repositioning === "dark" ? "Drag to reposition the dark mode cover" : "Drag to reposition"}
          </span>
        </div>
      )}

      {!isPeerNote && (
        <div
          className={cn(
            "absolute bottom-2 left-2 right-2 flex flex-wrap justify-end gap-1 transition-opacity duration-200",
            repositioning || isTouch
              ? "opacity-100"
              : "opacity-0 focus-within:opacity-100 group-hover:opacity-100 has-[[data-state=open]]:opacity-100",
          )}
        >
          {repositioning ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              aria-label="Done repositioning"
              className="text-xs"
              onClick={() => setRepositioning(null)}
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
                onClick={() => pickFile("light")}
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
                onClick={() => setRepositioning("light")}
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" size="sm" variant="secondary" aria-label="Dark mode cover" className="text-xs">
                    <Moon />
                    Dark mode
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {cover.dark ? (
                    <>
                      <DropdownMenuItem onSelect={() => pickFile("dark")}>
                        <ImagePlus />
                        Change dark mode cover
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setRepositioning("dark")}>
                        <Move />
                        Reposition dark mode cover
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => void removeCover("dark")}>
                        <Trash2 />
                        Remove dark mode cover
                      </DropdownMenuItem>
                    </>
                  ) : (
                    <DropdownMenuItem onSelect={() => pickFile("dark")}>
                      <ImagePlus />
                      Add dark mode cover
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          )}
          {fileInput}
        </div>
      )}
    </div>
  );
}
