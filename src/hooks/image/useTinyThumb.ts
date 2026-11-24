import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { type TargetDrive, DotYouClient, type SystemFileType } from '@homebase-id/js-lib/core';
import { getDecryptedThumbnailMeta, type ThumbnailMeta } from '@homebase-id/js-lib/media';
import { getDecryptedThumbnailMetaOverPeer } from '@homebase-id/js-lib/peer';
import { usePeerAccess } from '@/hooks/usePeerAccess';

export const useTinyThumb = (
  dotYouClient: DotYouClient,
  odinId?: string,
  imageFileId?: string,
  imageGlobalTransitId?: string,
  imageFileKey?: string,
  imageDrive?: TargetDrive,
  systemFileType?: SystemFileType
): UseQueryResult<ThumbnailMeta | null | undefined, Error> => {
  const localHost = dotYouClient.getHostIdentity();
  // No peer read (#1494): the host's server refuses every peer fetch, so make none
  const isPeer = !!odinId && odinId !== localHost;
  const canPeer = usePeerAccess(isPeer) === true;

  const fetchImageData = async (
    odinId: string,
    imageFileId?: string,
    imageGlobalTransitId?: string,
    imageFileKey?: string,
    imageDrive?: TargetDrive,
    systemFileType?: SystemFileType
  ) => {
    if (
      imageFileId === undefined ||
      imageFileId === '' ||
      imageFileKey === undefined ||
      imageFileKey === '' ||
      !imageDrive
    )
      return;

    if (odinId !== localHost)
      return (
        (await getDecryptedThumbnailMetaOverPeer(
          dotYouClient,
          odinId,
          imageDrive,
          imageFileId,
          imageGlobalTransitId,
          imageFileKey,
          systemFileType
        )) || null
      );

    return (
      (await getDecryptedThumbnailMeta(
        dotYouClient,
        imageDrive,
        imageFileId,
        imageFileKey,
        systemFileType
      )) || null
    );
  };

  return useQuery({
    queryKey: [
      'tinyThumb',
      odinId || localHost,
      imageDrive?.alias,
      imageGlobalTransitId || imageFileId,
      imageFileKey,
    ],
    queryFn: () =>
      fetchImageData(
        odinId || localHost,
        imageFileId,
        imageGlobalTransitId,
        imageFileKey,
        imageDrive,
        systemFileType
      ),
    gcTime: Infinity,
    staleTime: 1000 * 60 * 60, // 1 hour
    enabled: !!imageFileId && imageFileId !== '' && !!imageFileKey && imageFileKey !== '' && (!isPeer || canPeer),
  });
};
