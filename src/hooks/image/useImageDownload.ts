import { useContext } from 'react';
import { toast } from 'sonner';
import { getDecryptedImageUrl } from '@homebase-id/js-lib/media';
import { getDecryptedImageUrlOverPeer } from '@homebase-id/js-lib/peer';
import { useDotYouClientContext } from '@/components/auth';
import { ImageOwnerContext } from '@/components/editor/nodes/imageOwnerContext';
import { JOURNAL_DRIVE } from '@/lib/homebase/config';
import { getLocalImageBytes, getPendingImageUpload } from '@/lib/db';
import { imageFilename, saveBlob } from '@/lib/images/imageDownload';

/**
 * Save an image node's original bytes: the queued upload while pending, the
 * copy kept on this device if there is one, else the full payload from the
 * server (over peer for a note shared with you).
 */
export function useImageDownload(src: string, alt: string, pendingId?: string | null) {
    const dotYouClient = useDotYouClientContext();
    const owner = useContext(ImageOwnerContext);

    const load = async (): Promise<Blob | null> => {
        if (src.startsWith('attachment://')) {
            const [fileId, key] = src.replace('attachment://', '').split('/');
            const local = await getLocalImageBytes(fileId, key);
            if (local) return new Blob([new Uint8Array(local.blobData)], { type: local.contentType });
            const options = { preferObjectUrl: true };
            const url = owner
                ? await getDecryptedImageUrlOverPeer(dotYouClient, owner, JOURNAL_DRIVE, fileId, key, undefined, undefined, options)
                : await getDecryptedImageUrl(dotYouClient, JOURNAL_DRIVE, fileId, key, undefined, undefined, options);
            return url ? (await fetch(url)).blob() : null;
        }
        if (pendingId) {
            const row = await getPendingImageUpload(pendingId);
            if (row) return new Blob([new Uint8Array(row.blobData)], { type: row.contentType });
        }
        return (await fetch(src)).blob();
    };

    return async () => {
        try {
            const blob = await load();
            if (!blob) throw new Error('image not found');
            saveBlob(blob, imageFilename(alt, blob.type));
        } catch (error) {
            console.error('[useImageDownload] Failed to download image:', error);
            toast.error('Failed to download image');
        }
    };
}
