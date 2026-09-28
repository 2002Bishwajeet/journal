/**
 * Full-resolution, click-to-zoom view of an image node. `attachment://` sources
 * reuse OdinImage to fetch the real payload at full size; everything else
 * (plain URLs, the pending upload's live object URL) is a plain <img>.
 */
import { useContext } from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { OdinImage } from "@/components/OdinImage/OdinImage";
import { useDotYouClientContext } from "@/components/auth";
import { JOURNAL_DRIVE } from "@/lib/homebase/config";
import { ImageOwnerContext } from "./imageOwnerContext";

interface ImageLightboxProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
}

export function ImageLightbox({ open, onOpenChange, src, alt }: ImageLightboxProps) {
  const dotYouClient = useDotYouClientContext();
  const owner = useContext(ImageOwnerContext);
  const isAttachment = src.startsWith("attachment://");
  const [fileId, fileKey] = src.replace("attachment://", "").split("/");

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
        {alt && <p aria-hidden="true" className="text-center text-sm text-white/90">{alt}</p>}
      </DialogContent>
    </Dialog>
  );
}
