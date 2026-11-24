import { useDotYouClientContext } from '@/components/auth';
import { type SystemFileType, type TargetDrive, getPayloadAsJson } from '@homebase-id/js-lib/core';
import { type LinkPreview } from '@homebase-id/js-lib/media';
import {
    getPayloadAsJsonOverPeer,
    getPayloadAsJsonOverPeerByGlobalTransitId,
} from '@homebase-id/js-lib/peer';
import { useQuery } from '@tanstack/react-query';
import { usePeerAccess } from '@/hooks/usePeerAccess';


export const useLinkMetadata = ({
    odinId,
    globalTransitId,
    targetDrive,
    fileId,
    payloadKey,
    systemFileType,
}: {
    odinId?: string;
    globalTransitId?: string;
    targetDrive: TargetDrive;
    fileId?: string;
    payloadKey: string;
    systemFileType?: SystemFileType;
}) => {
    const dotYouClient = useDotYouClientContext();
    // No peer read (#1494): the host's server refuses every peer fetch, so make none
    const canPeer = usePeerAccess() === true;
    const isPeer = !!odinId && dotYouClient.getHostIdentity() !== odinId;

    return useQuery({
        queryKey: ['link-metadata', targetDrive.alias, fileId, payloadKey],
        queryFn: async () => {
            if (isPeer) {
                if (globalTransitId) {
                    return getPayloadAsJsonOverPeerByGlobalTransitId<LinkPreview[]>(
                        dotYouClient,
                        odinId,
                        targetDrive,
                        globalTransitId,
                        payloadKey,
                        {
                            systemFileType,
                        }
                    );
                } else if (fileId) {
                    return getPayloadAsJsonOverPeer<LinkPreview[]>(
                        dotYouClient,
                        odinId,
                        targetDrive,
                        fileId,
                        payloadKey,
                        { systemFileType }
                    );
                }
            }

            if (!fileId) return [];
            return getPayloadAsJson<LinkPreview[]>(dotYouClient, targetDrive, fileId, payloadKey, {
                systemFileType,
            });
        },
        staleTime: 1000 * 60 * 60 * 24, // 24 hours
        enabled: !isPeer || canPeer,
    });
};
