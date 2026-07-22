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
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";
import { JOURNAL_DRIVE } from "@/lib/homebase/config";
import { useDotYouClientContext } from "@/components/auth";
import { OdinImage } from "@/components/OdinImage/OdinImage";
import { cn } from "@/lib/utils";

export const MIN_IMAGE_WIDTH = 64;

export type ImageAlign = "left" | "center" | "right";

/**
 * Float styles for an aligned image. Left/right float so text wraps around the
 * image; center is a block with auto margins, which needs the explicit width the
 * resize handles set.
 *
 * ponytail: every key here must stay a single-word CSS property — extensions.ts
 * serialises this same map into the exported <img>'s style string, so a camelCase
 * key would come out as invalid CSS. Deliberately no `width`: it would fight the
 * pixel width in that same string.
 */
export const ALIGN_STYLE: Record<ImageAlign, Record<string, string>> = {
  left: { float: "left", margin: "0 1rem 0.5rem 0" },
  right: { float: "right", margin: "0 0 0.5rem 1rem" },
  center: { display: "block", margin: "0 auto" },
};

/**
 * Width a drag to `clientX` produces. Left-side handles mirror the delta so both
 * sides grow outward, and the result is clamped to the content column. Height is
 * never stored, so the aspect ratio is preserved by construction.
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

export function ImageNodeView({
  node,
  updateAttributes,
  selected,
}: NodeViewProps) {
  const dotYouClient = useDotYouClientContext();
  const src = node.attrs.src as string;
  const pendingId = node.attrs["data-pending-id"] as string | undefined;
  const width = node.attrs.width as number | null;
  const align = node.attrs.align as ImageAlign | null;
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
      // Clicking a control must not move the selection off the image.
      onMouseDown={(e) => e.preventDefault()}
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
      style={{ ...(align ? ALIGN_STYLE[align] : {}), width: width ?? "fit-content" }}
      className={cn(
        "group relative inline-block max-w-full",
        selected && "outline outline-2 outline-primary/60 rounded-sm",
      )}
    >
      {children}
      {CORNERS.map(corner)}
      {alignBar}
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

