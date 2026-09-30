/**
 * Fetches a link preview (#173) through the Homebase SDK, which extracts the
 * page metadata server-side and caches the result (including a miss) per URL
 * for the page session. The og:image comes back as a data URI; it is shrunk to
 * a small webp data URI so it can live in the note's Yjs doc. A remote image
 * URL is never kept (no hot-linking).
 */
import type { DotYouClient } from '@homebase-id/js-lib/core';
import { getLinkPreview, resizeImageFromBlob } from '@homebase-id/js-lib/media';
import { dataUriToBlob, toPreviewAttrs, type LinkPreviewAttrs } from '@/lib/editor/linkPreview';

const MAX_IMAGE_CHARS = 60_000;

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function shrinkImage(imageUrl: string | undefined): Promise<string | null> {
  const blob = imageUrl ? dataUriToBlob(imageUrl) : null;
  if (!blob) return null;
  try {
    const resized = await resizeImageFromBlob(blob, 70, 480, undefined, 'webp', false, 40_000);
    const uri = await blobToDataUri(resized.blob);
    return uri.startsWith('data:image/') && uri.length <= MAX_IMAGE_CHARS ? uri : null;
  } catch {
    return null;
  }
}

export async function fetchLinkPreview(dotYouClient: DotYouClient, url: string): Promise<LinkPreviewAttrs | null> {
  const preview = await getLinkPreview(dotYouClient, url);
  if (!preview) return null;
  // Keep the pasted (already validated) URL rather than whatever the extractor echoes back.
  return toPreviewAttrs({ ...preview, url }, await shrinkImage(preview.imageUrl));
}
