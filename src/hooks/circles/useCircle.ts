import { QueryClient, useQuery } from '@tanstack/react-query';
import {
    getCircle,
    fetchMembersOfCircle,
} from '@homebase-id/js-lib/network';
import { formatGuidId } from '@homebase-id/js-lib/helpers';


import { useDotYouClientContext } from '@/components/auth';


export const useCircle = (props?: { circleId?: string }) => {
    const { circleId } = props || {};
    const dotYouClient = useDotYouClientContext();


    const fetch = async ({ circleId }: { circleId: string }) => {
        if (!circleId) {
            return;
        }
        return await getCircle(dotYouClient, circleId);
    };

    const fetchMembers = async ({ circleId }: { circleId: string }) => {
        if (!circleId) {
            return;
        }
        return await fetchMembersOfCircle(dotYouClient, circleId);
    };



    return {
        fetch: useQuery({
            queryKey: ['circle', circleId],
            queryFn: () => fetch({ circleId: circleId as string }),
            refetchOnWindowFocus: false,
            enabled: !!circleId,
        }),

        fetchMembers: useQuery({
            queryKey: ['circleMembers', circleId],
            queryFn: () => fetchMembers({ circleId: circleId as string }),

            refetchOnWindowFocus: false,
            enabled: !!circleId,
        }),
    };
}
export const invalidateCircle = (queryClient: QueryClient, circleId: string) => {
    queryClient.invalidateQueries({ queryKey: ['circle', formatGuidId(circleId)] });
};

export const invalidateCircleMembers = (queryClient: QueryClient, circleId: string) => {
    queryClient.invalidateQueries({ queryKey: ['circleMembers', formatGuidId(circleId)] });
};
