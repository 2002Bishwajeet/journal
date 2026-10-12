/**
 * Full-resolution, click-to-zoom view of an image node. `attachment://` sources
 * reuse OdinImage to fetch the real payload at full size; everything else
 * (plain URLs, the pending upload's live object URL) is a plain <img>.
 */
import { useContext, useState } from "react";
import { Download } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { OdinImage } from "@/components/OdinImage/OdinImage";
import { useDotYouClientContext } from "@/components/auth";
import { JOURNAL_DRIVE } from "@/lib/homebase/config";
import { useImageDownload } from "@/hooks/image/useImageDownload";
import { useZoomPan } from "@/hooks/image/useZoomPan";
import { ImageOwnerContext } from "./imageOwnerContext";

interface ImageLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
}

/** Mounted only while the dialog is open, so every opening starts fitted. */
function ZoomStage({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  const dotYouClient = useDotYouClientContext();
  const owner = useContext(ImageOwnerContext);
  const isAttachment = src.startsWith("attachment://");
  const [fileId, fileKey] = src.replace("attachment://", "").split("/");
  const [stage, setStage] = useState<HTMLDivElement | null>(null);
  const { view, stageProps, wasDragged } = useZoomPan(stage);

  return (
    // Wheel/pinch zooms, drag pans, double-click toggles fit and 100%
    <div
      ref={setStage}
      {...stageProps}
      onClick={(e) => {
        stageProps.onClick(e);
        // Zoomed in, the empty area is part of a pan or double-click, not a dismissal
        if (e.target === e.currentTarget && view.scale === 1 && !wasDragged()) onClose();
      }}
      // A native image drag would cancel the pointer stream a pan needs
      onDragStart={(e) => e.preventDefault()}
      style={{ touchAction: "none" }}
      className={`flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden ${view.scale > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
    >
      <div
        data-testid="lightbox-zoom"
        // w-full, not shrink-wrapped: OdinImage is 100% of this box, so a
        // shrink-wrapped box collapses both to 0×0 and the image never shows.
        className="flex w-full justify-center"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
      >
        {isAttachment ? (
          <OdinImage
            dotYouClient={dotYouClient}
            odinId={owner}
            targetDrive={JOURNAL_DRIVE}
            fileId={fileId}
            fileKey={fileKey}
            alt={alt}
            lazyLoad={false}
            fit="contain"
            className="max-h-[calc(95vh-3rem)]"
          />
        ) : (
          <img src={src} alt={alt} className="max-h-[calc(95vh-3rem)] max-w-full object-contain" />
        )}
      </div>
    </div>
  );
}

export function ImageLightbox({ open, onOpenChange, src, alt }: ImageLightboxProps) {
  const download = useImageDownload(src, alt);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* sm:max-w-[95vw] overrides the base DialogContent's sm:max-w-lg, which
          otherwise caps the lightbox at 32rem. The fixed box also gives OdinImage
          a large clientWidth to pick its thumbnail size from. */}
      <DialogContent
        aria-label={alt || "Image preview"}
        onClick={(e) => {
          // The box covers the viewport, so treat clicks on the empty area as outside clicks.
          if (e.target === e.currentTarget) onOpenChange(false);
        }}
        className="flex h-[95vh] w-[95vw] max-w-[95vw] sm:max-w-[95vw] flex-col items-center justify-center gap-3 p-0 bg-transparent border-0 shadow-none"
      >
        <button
          type="button"
          aria-label="Download image"
          onClick={download}
          className="absolute top-4 right-12 z-10 rounded-xs p-0.5 text-white/80 hover:text-white focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Download className="size-4" />
        </button>
        <ZoomStage src={src} alt={alt} onClose={() => onOpenChange(false)} />
        {alt && <p aria-hidden="true" className="text-center text-sm text-white/90">{alt}</p>}
      </DialogContent>
    </Dialog>
  );
}
