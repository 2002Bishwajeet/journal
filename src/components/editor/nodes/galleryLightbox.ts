import type { EditorState } from '@tiptap/pm/state';
import { readEdits } from '@/lib/images/imageEdits';
import type { LightboxGallery } from '@/lib/images/lightboxGallery';
import { GALLERY } from './GalleryNode';
import { canZoom, imageRenderMode } from './imageLayout';

/**
 * The images the lightbox steps through when the image at `pos` opens (#1369): those of
 * its gallery, in order, less any still uploading (they have no stable src to show).
 * Undefined outside a gallery, or when it leaves a single image.
 */
export function galleryLightbox(state: EditorState, pos: number): LightboxGallery | undefined {
  if (pos > state.doc.content.size) return undefined;
  const $pos = state.doc.resolve(pos);
  if ($pos.parent.type.name !== GALLERY) return undefined;
  const items: LightboxGallery['items'] = [];
  let index = 0;
  $pos.parent.forEach((child, offset) => {
    const src = child.attrs.src as string;
    if (!canZoom(imageRenderMode(src, child.attrs['data-pending-id']))) return;
    if (offset === $pos.parentOffset) index = items.length;
    items.push({ src, alt: (child.attrs.alt as string | null) ?? '', edits: readEdits(child.attrs) });
  });
  return items.length > 1 ? { items, index } : undefined;
}
