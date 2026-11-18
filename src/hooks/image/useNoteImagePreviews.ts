import { useQuery } from '@tanstack/react-query';
import { getFileHeader } from '@homebase-id/js-lib/core';
import { useDotYouClientContext } from '@/components/auth';
import { JOURNAL_DRIVE } from '@/lib/homebase/config';
import { payloadPreviews, type PayloadPreview } from '@/lib/images/imageSize';

/**
 * The tiny thumbnail, size and thumbnail sizes of every image payload on a note file (#1387),
 * by payload key, from one read of the file's header: the note's images are payloads on the
 * note's own file, so they need no request each. Undefined while loading, offline, or for a
 * file not on this drive (a note shared with you passes no `fileId`).
 */
export function useNoteImagePreviews(fileId: string | undefined): Record<string, PayloadPreview> | undefined {
    const dotYouClient = useDotYouClientContext();
    return useQuery({
        queryKey: ['noteImagePreviews', dotYouClient.getHostIdentity(), fileId],
        queryFn: async () => {
            const header = await getFileHeader(dotYouClient, JOURNAL_DRIVE, fileId!, { decrypt: true });
            return payloadPreviews(header?.fileMetadata.payloads);
        },
        enabled: !!fileId,
        staleTime: 5 * 60 * 1000,
        retry: false,
    }).data;
}
