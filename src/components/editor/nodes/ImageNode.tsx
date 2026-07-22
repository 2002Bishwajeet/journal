/**
 * Custom Image Node View
 *
 * Renders images with different strategies based on source:
 * - Pending uploads: Show local blob with "Uploading..." overlay
 * - Remote images: Use OdinImage with thumbnail loading
 * - Regular URLs/base64: Standard img tag
 */

import { useRef, type ReactNode } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { JOURNAL_DRIVE } from "@/lib/homebase/config";
import { useDotYouClientContext } from "@/components/auth";
import { OdinImage } from "@/components/OdinImage/OdinImage";
import { cn } from "@/lib/utils";

export const MIN_IMAGE_WIDTH = 64;

/**
 * Width a drag to `clientX` produces. The left handle mirrors the delta so both
 * sides grow outward, and the result is clamped to the content column.
 */
export function resizeWidth(
  side: "left" | "right",
  startWidth: number,
  startX: number,
  clientX: number,
  maxWidth: number,
): number {
  const delta = side === "right" ? clientX - startX : startX - clientX;
  return Math.round(
    Math.min(Math.max(startWidth + delta, MIN_IMAGE_WIDTH), maxWidth),
  );
}

export function ImageNodeView({
  node,
  updateAttributes,
  selected,
}: NodeViewProps) {
  const dotYouClient = useDotYouClientContext();
  const src = node.attrs.src as string;
  const pendingId = node.attrs["data-pending-id"] as string | undefined;
  const width = node.attrs.width as number | null;
  const boxRef = useRef<HTMLDivElement>(null);

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

  const handle = (side: "left" | "right") => (
    <button
      type="button"
      draggable={false}
      aria-label={`Resize image (${side} edge)`}
      onPointerDown={startDrag(side)}
      onKeyDown={onHandleKeyDown}
      // touch-action:none so dragging on a touch screen resizes instead of scrolling.
      style={{ touchAction: "none" }}
      className={cn(
        // 20px hit target around a 6px bar — thin enough to look light, wide
        // enough to grab with a finger.
        "absolute inset-y-0 my-auto flex h-12 w-5 items-center justify-center",
        "cursor-ew-resize opacity-0 transition-opacity",
        "focus-visible:opacity-100 group-hover:opacity-100",
        selected && "opacity-100",
        side === "left" ? "left-0.5" : "right-0.5",
      )}
    >
      <span className="h-full w-1.5 rounded-full bg-primary ring-1 ring-background" />
    </button>
  );

  // Until a width is set the box shrink-wraps the image, so the image keeps its
  // natural size (previous behaviour); once sized, it fills the box.
  const imgClass = width ? "w-full h-auto" : "max-w-full";

  const resizable = (children: ReactNode) => (
    <div
      ref={boxRef}
      style={{ width: width ?? undefined }}
      className={cn(
        "group relative inline-block max-w-full",
        selected && "outline outline-2 outline-primary/60 rounded-sm",
      )}
    >
      {children}
      {handle("left")}
      {handle("right")}
    </div>
  );

  // Case 1: Still pending upload (local blob URL)
  if (pendingId || src.startsWith("blob:")) {
    return (
      <NodeViewWrapper className="image-node" data-drag-handle>
        <div className="relative inline-block">
          <img src={src} alt="" className="max-w-full opacity-70" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/20">
            <span className="text-xs bg-black/60 text-white px-2 py-1 rounded flex items-center gap-1">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Uploading...
            </span>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  // Case 2: Remote image (attachment://fileId/payloadKey)
  if (src.startsWith("attachment://")) {
    const [fileId, payloadKey] = src.replace("attachment://", "").split("/");

    return (
      <NodeViewWrapper className="image-node" data-drag-handle>
        {resizable(
          <OdinImage
            dotYouClient={dotYouClient}
            targetDrive={JOURNAL_DRIVE}
            fileId={fileId}
            fileKey={payloadKey}
            className={imgClass}
          />,
        )}
      </NodeViewWrapper>
    );
  }

  // Case 3: Regular URL or base64
  return (
    <NodeViewWrapper className="image-node" data-drag-handle>
      {resizable(<img src={src} alt="" className={imgClass} />)}
    </NodeViewWrapper>
  );
}

