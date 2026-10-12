import { useEffect, useRef, useState, type ReactNode } from 'react';
import { editLayers, editedSize, type ImageEdits, type Size } from '@/lib/images/imageEdits';

interface EditedImageProps {
  edits: ImageEdits;
  /** Fit the box within this height too (a CSS length); else it is as wide as its container. */
  maxHeight?: string;
  /** Drawn over the edited box, e.g. the edit dialog's crop rectangle. */
  overlay?: ReactNode;
  /** The image itself, sized to fill its parent (an <img>, or OdinImage). */
  children: ReactNode;
}

/**
 * An image with its crop, rotate and flip (#584) applied in CSS only (layers in
 * src/lib/images/imageEdits.ts). The natural size comes from whichever <img> loads
 * inside; until then the image lays out unedited and hidden, so it never flashes
 * the original. Used by the editor, the lightbox, the edit dialog and the share page.
 */
export function EditedImage({ edits, maxHeight, overlay, children }: EditedImageProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<Size | null>(null);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    // The largest wins: OdinImage shows a tiny blurred preview before the real image.
    const measure = (img: HTMLImageElement) => {
      const { naturalWidth: width, naturalHeight: height } = img;
      if (width && height) setNatural((prev) => (prev && prev.width >= width ? prev : { width, height }));
    };
    frame.querySelectorAll('img').forEach((img) => img.complete && measure(img));
    // load doesn't bubble, but it does pass through the capture phase.
    const onLoad = (e: Event) => {
      if (e.target instanceof HTMLImageElement) measure(e.target);
    };
    frame.addEventListener('load', onLoad, true);
    return () => frame.removeEventListener('load', onLoad, true);
  }, []);

  const layers = natural && editLayers(natural, edits);
  const box = natural && editedSize(natural, edits);
  const width = maxHeight && box ? `min(100%, calc(${maxHeight} * ${box.width / box.height}))` : '100%';

  return (
    <div
      ref={frameRef}
      data-testid="edited-image"
      className="image-edit"
      style={layers ? { ...layers.frame, width } : { width, visibility: 'hidden' }}
    >
      <div style={layers?.stage}>
        <div style={layers?.image}>{children}</div>
      </div>
      {layers && overlay}
    </div>
  );
}
