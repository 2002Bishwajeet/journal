import { useQuery } from '@tanstack/react-query';
import { ApiType, getSecurityContext, getSecurityContextOverPeer } from '@homebase-id/js-lib/core';
import { useDotYouClientContext } from '@/components/auth';


export const useSecurityContext = (odinId?: string, isEnabled?: boolean) => {
  const dotYouClient = useDotYouClientContext();

  const fetch = async (odinId?: string) => {
    if (
      !odinId ||
      odinId === window.location.hostname ||
      (dotYouClient.getType() === ApiType.App && odinId === dotYouClient.getHostIdentity())
    )
      return await getSecurityContext(dotYouClient);
    else return await getSecurityContextOverPeer(dotYouClient, odinId);
  };

  return {
    fetch: useQuery({
      queryKey: ['security-context', odinId],
      queryFn: () => fetch(odinId),
      //TODO: Lets fix this cache sometime else
      // staleTime: 1000 * 60 * 60, // 1 hour
      staleTime: 0, // Disable cache to ensure we always have the latest permissions after granting
      enabled: isEnabled === undefined ? true : isEnabled,
    }),
  };
};
