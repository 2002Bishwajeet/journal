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
      <DialogContent
        aria-label={alt || "Image preview"}
        className="max-w-[95vw] max-h-[95vh] p-0 bg-transparent border-0 shadow-none"
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
            className="max-h-[95vh]"
          />
        ) : (
          <img src={src} alt={alt} className="max-h-[95vh] max-w-[95vw] object-contain" />
        )}
      </DialogContent>
    </Dialog>
  );
}
