/**
 * Custom Image Node View
 *
 * Renders images with different strategies based on source:
 * - Pending uploads: Show the locally queued bytes with an upload-state overlay
 * - Remote images: Use OdinImage with thumbnail loading
 * - Regular URLs/base64: Standard img tag
 */

import { useContext, useRef, useState, type ReactNode } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { AlignCenter, AlignLeft, AlignRight, Loader2, Maximize2 } from "lucide-react";
import { JOURNAL_DRIVE } from "@/lib/homebase/config";
import { useDotYouClientContext } from "@/components/auth";
import { OdinImage } from "@/components/OdinImage/OdinImage";
import { cn } from "@/lib/utils";
import { deletePendingImageUpload, retryPendingImageUploadNow } from "@/lib/db";
import { usePendingImage } from "@/hooks/usePendingImage";
import { useSyncService } from "@/hooks/useSyncService";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import {
  ALIGN_STYLE,
  MIN_IMAGE_WIDTH,
  canZoom,
  imageBoxWidth,
  imageRenderMode,
  resizeWidth,
  type ImageAlign,
} from "./imageLayout";
import { ImageOwnerContext } from "./imageOwnerContext";
import { ImageLightbox } from "./ImageLightbox";

// Corner, the edge it drags, and the diagonal cursor for it.
const CORNERS = [
  { name: "top left", pos: "top-0 left-0", side: "left", cursor: "cursor-nwse-resize" },
  { name: "top right", pos: "top-0 right-0", side: "right", cursor: "cursor-nesw-resize" },
  { name: "bottom left", pos: "bottom-0 left-0", side: "left", cursor: "cursor-nesw-resize" },
  { name: "bottom right", pos: "bottom-0 right-0", side: "right", cursor: "cursor-nwse-resize" },
] as const;

const ALIGN_BUTTONS = [
  { align: "left", icon: AlignLeft, label: "Float left" },
  { align: "center", icon: AlignCenter, label: "Center" },
  { align: "right", icon: AlignRight, label: "Float right" },
] as const;

const PENDING_LABEL = {
  offline: "Waiting for connection",
  uploading: "Uploading…",
  failed: "Upload failed",
} as const;

function PendingImage({
  pendingId,
  imgClass,
  alt,
  onRemove,
}: {
  pendingId: string;
  imgClass: string;
  alt: string;
  onRemove: () => void;
}) {
  const { url, state } = usePendingImage(pendingId);
  const { sync } = useSyncService();

  if (state === "remote") {
    return (
      <div className="flex h-32 w-64 max-w-full items-center justify-center rounded-sm bg-muted text-xs text-muted-foreground">
        Uploading from another device…
      </div>
    );
  }

  const retry = async () => {
    await retryPendingImageUploadNow(pendingId);
    sync().catch((err) => console.error("[ImageNode] Retry sync failed:", err));
  };
  const remove = () => {
    onRemove();
    void deletePendingImageUpload(pendingId);
  };
  const actionClass = "rounded bg-white/20 px-1.5 hover:bg-white/30";

  return (
    <>
      {url && <img src={url} alt={alt} className={cn(imgClass, "opacity-70")} />}
      <div
        contentEditable={false}
        // Clicking Retry/Remove must not move the selection onto the image.
        onMouseDown={(e) => e.preventDefault()}
        className="absolute inset-0 flex items-center justify-center bg-black/20"
      >
        <span className="text-xs bg-black/60 text-white px-2 py-1 rounded flex items-center gap-1">
          {state === "uploading" && <Loader2 className="h-3 w-3 animate-spin" />}
          {PENDING_LABEL[state]}
          {state === "failed" && (
            <>
              <button type="button" className={actionClass} onClick={retry}>
                Retry
              </button>
              <button type="button" className={actionClass} onClick={remove}>
                Remove
              </button>
            </>
          )}
        </span>
      </div>
    </>
  );
}

export function ImageNodeView({
  node,
  updateAttributes,
  deleteNode,
  selected,
}: NodeViewProps) {
  const dotYouClient = useDotYouClientContext();
  const owner = useContext(ImageOwnerContext);
  const src = node.attrs.src as string;
  const pendingId = node.attrs["data-pending-id"] as string | undefined;
  const width = node.attrs.width as number | null;
  const align = node.attrs.align as ImageAlign | null;
  const alt = (node.attrs.alt as string | null) ?? "";
  const mode = imageRenderMode(src, pendingId);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const saveAlt = (value: string) => updateAttributes({ alt: value.trim() || null });

  // The column the image sits in — the widest it may become.
  const maxWidth = () => boxRef.current?.parentElement?.offsetWidth ?? Infinity;

  const startDrag = (side: "left" | "right") => (e: React.PointerEvent) => {
    // Also stops ProseMirror from starting a node drag from the wrapper.
    e.preventDefault();
    const box = boxRef.current;
    if (!box) return;

    const startX = e.clientX;
    const startWidth = box.offsetWidth;
    const max = maxWidth();

    // Write the live width straight to the DOM: no re-render per frame, and the
    // single commit on release keeps the whole resize as one undo step.
    const onMove = (ev: PointerEvent) => {
      box.style.width = `${resizeWidth(side, startWidth, startX, ev.clientX, max)}px`;
    };
    const onUp = () => {
      document.removeEventListener("pointermove", onMove);
      updateAttributes({ width: box.offsetWidth });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp, { once: true });
  };

  // Keyboard equivalent of the drag, so resizing isn't pointer-only.
  const onHandleKeyDown = (e: React.KeyboardEvent) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!dir) return;
    e.preventDefault();
    const box = boxRef.current;
    if (!box) return;
    const next = box.offsetWidth + dir * (e.shiftKey ? 64 : 16);
    updateAttributes({
      width: Math.round(
        Math.min(Math.max(next, MIN_IMAGE_WIDTH), maxWidth()),
      ),
    });
  };

  const corner = ({ name, pos, side, cursor }: (typeof CORNERS)[number]) => (
    <button
      key={name}
      type="button"
      draggable={false}
      contentEditable={false}
      aria-label={`Resize image (${name})`}
      onPointerDown={startDrag(side)}
      onKeyDown={onHandleKeyDown}
      // touch-action:none so dragging on a touch screen resizes instead of scrolling.
      style={{ touchAction: "none" }}
      className={cn(
        // 20px hit target around a 10px square — big enough for a finger,
        // small enough not to cover the corner of the image.
        "absolute flex h-5 w-5 items-center justify-center",
        "opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100",
        selected && "opacity-100",
        pos,
        cursor,
      )}
    >
      <span className="h-2.5 w-2.5 rounded-[2px] bg-primary ring-1 ring-background" />
    </button>
  );

  const alignBar = (
    <div
      contentEditable={false}
      // Clicking a control must not move the selection off the image — but
      // only a control: the ALT popover below has a real text input, which
      // needs mousedown's default focus behaviour to work.
      onMouseDown={(e) => {
        if ((e.target as HTMLElement).closest("button")) e.preventDefault();
      }}
      className={cn(
        "absolute -top-9 left-1/2 z-10 flex -translate-x-1/2 gap-0.5",
        "rounded-md border bg-popover p-0.5 shadow-md",
        "opacity-0 transition-opacity group-hover:opacity-100",
        selected && "opacity-100",
      )}
    >
      {ALIGN_BUTTONS.map(({ align: value, icon: Icon, label }) => (
        <button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={align === value}
          // Clicking the active one clears it, back to normal text flow.
          onClick={() =>
            updateAttributes({ align: align === value ? null : value })
          }
          className={cn(
            "rounded p-1 hover:bg-accent hover:text-accent-foreground",
            align === value && "bg-accent text-accent-foreground",
          )}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Alt text"
            aria-pressed={!!alt}
            className={cn(
              "rounded p-1 text-xs font-semibold hover:bg-accent hover:text-accent-foreground",
              alt && "bg-accent text-accent-foreground",
            )}
          >
            ALT
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-56 p-2">
          <Input
            defaultValue={alt}
            placeholder="Describe this image"
            aria-label="Alt text"
            // Keystrokes must not leak into ProseMirror's own shortcuts.
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter") {
                e.preventDefault();
                saveAlt(e.currentTarget.value);
              }
            }}
            onBlur={(e) => saveAlt(e.currentTarget.value)}
          />
        </PopoverContent>
      </Popover>
      {canZoom(mode) && (
        <button
          type="button"
          aria-label="View full size"
          onClick={() => setLightboxOpen(true)}
          className="rounded p-1 hover:bg-accent hover:text-accent-foreground"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );

  // Until a width is set the box shrink-wraps the image, so the image keeps its
  // natural size (previous behaviour); once sized, it fills the box.
  const imgClass = width ? "w-full h-auto" : "max-w-full";

  const resizable = (children: ReactNode) => (
    <div
      ref={boxRef}
      // width last: centering sets `display: block`, which would otherwise
      // stretch the box to the full column instead of hugging the image.
      style={{ ...(align ? ALIGN_STYLE[align] : {}), width: imageBoxWidth(mode, width) }}
      className={cn(
        "group relative inline-block max-w-full",
        selected && "outline outline-2 outline-primary/60 rounded-sm",
      )}
      // A resize handle or an alignBar control (both buttons) already has its
      // own click behaviour; don't also pop the lightbox open under it.
      onDoubleClick={(e) => {
        if (!canZoom(mode)) return;
        if ((e.target as HTMLElement).closest("button")) return;
        setLightboxOpen(true);
      }}
    >
      {children}
      {CORNERS.map(corner)}
      {alignBar}
      <ImageLightbox open={lightboxOpen} onOpenChange={setLightboxOpen} src={src} alt={alt} />
    </div>
  );

  // Mode "pending": not uploaded yet. The blob: src dies with the tab, so the
  // bytes come from the local upload queue instead.
  if (mode === "pending" && pendingId) {
    return (
      <NodeViewWrapper className="image-node" data-drag-handle>
        {resizable(
          <PendingImage
            pendingId={pendingId}
            imgClass={imgClass}
            alt={alt}
            onRemove={deleteNode}
          />,
        )}
      </NodeViewWrapper>
    );
  }

  // Mode "attachment": remote image (attachment://fileId/payloadKey)
  if (mode === "attachment") {
    const [fileId, payloadKey] = src.replace("attachment://", "").split("/");

    return (
      <NodeViewWrapper className="image-node" data-drag-handle>
        {resizable(
          <OdinImage
            dotYouClient={dotYouClient}
            odinId={owner}
            targetDrive={JOURNAL_DRIVE}
            fileId={fileId}
            fileKey={payloadKey}
            alt={alt}
            className={imgClass}
          />,
        )}
      </NodeViewWrapper>
    );
  }

  // Mode "plain": regular URL or base64
  return (
    <NodeViewWrapper className="image-node" data-drag-handle>
      {resizable(<img src={src} alt={alt} className={imgClass} />)}
    </NodeViewWrapper>
  );
}
