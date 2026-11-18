import { cn } from '@/lib/utils';
import type { Size } from '@/lib/images/imageEdits';
import { thumbSrc, type PayloadPreview } from '@/lib/images/imageSize';

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';

/**
 * Holds an image's box before its bytes arrive (#1387): an <img> of the image's size showing
 * the note file's tiny thumbnail (the browser smooths it up to size) or a muted block. An <img>
 * with the real image's classes, so spacing, rounding, width and gallery rules are the same
 * and nothing moves when the real one replaces it. Hidden from assistive tech and from the
 * code that reads loaded images (aria-hidden, like OdinImage's own preview).
 */
export function ImagePlaceholder({ size, thumb, className }: { size: Size; thumb?: PayloadPreview['thumb']; className?: string }) {
    return (
        <img
            src={thumb ? thumbSrc(thumb) : BLANK}
            width={size.width}
            height={size.height}
            alt=""
            aria-hidden="true"
            data-testid="image-placeholder"
            className={cn('bg-muted', className)}
        />
    );
}
