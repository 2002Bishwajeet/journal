/**
 * Custom Image Node View
 *
 * Renders images with different strategies based on source:
 * - Pending uploads: Show local blob with "Uploading..." overlay
 * - Remote images: Use OdinImage with thumbnail loading
 * - Regular URLs/base64: Standard img tag
 */

import { useRef } from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import { JOURNAL_DRIVE } from "@/lib/homebase/config";
import { useDotYouClientContext } from "@/components/auth";
import { OdinImage } from "@/components/OdinImage/OdinImage";

export function ImageNodeView({ node, updateAttributes }: NodeViewProps) {
  const dotYouClient = useDotYouClientContext();
  const src = node.attrs.src as string;
  const pendingId = node.attrs["data-pending-id"] as string | undefined;
  const width = node.attrs.width as number | null;
  const boxRef = useRef<HTMLDivElement>(null);

  // CSS `resize` gives us the browser's own grabber — no pointer math, no drag
  // state. Commit the resulting width once on release so a resize is a single
  // undo step rather than one per frame.
  const commitWidth = () => {
    const w = boxRef.current?.offsetWidth;
    if (w && w !== width) updateAttributes({ width: w });
  };
  const resizeBox = {
    ref: boxRef,
    onPointerDown: () =>
      document.addEventListener("pointerup", commitWidth, { once: true }),
    style: { width: width ?? undefined },
    className: "inline-block max-w-full resize-x overflow-hidden",
  };
  // Until a width is set the box shrink-wraps the image, so the image keeps its
  // natural size (previous behaviour); once sized, it fills the box.
  const imgClass = width ? "w-full h-auto" : "max-w-full";

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
        <div {...resizeBox}>
          <OdinImage
            dotYouClient={dotYouClient}
            targetDrive={JOURNAL_DRIVE}
            fileId={fileId}
            fileKey={payloadKey}
            className={imgClass}
          />
        </div>
      </NodeViewWrapper>
    );
  }

  // Case 3: Regular URL or base64
  return (
    <NodeViewWrapper className="image-node" data-drag-handle>
      <div {...resizeBox}>
        <img src={src} alt="" className={imgClass} />
      </div>
    </NodeViewWrapper>
  );
}

