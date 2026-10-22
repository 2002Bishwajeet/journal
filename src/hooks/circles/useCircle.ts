import { useQuery } from '@tanstack/react-query';
import { fetchMembersOfCircle } from '@homebase-id/js-lib/network';


import { useDotYouClientContext } from '@/components/auth';


export const useCircle = (props?: { circleId?: string }) => {
    const { circleId } = props || {};
    const dotYouClient = useDotYouClientContext();


    const fetchMembers = async ({ circleId }: { circleId: string }) => {
        if (!circleId) {
            return;
        }
        return await fetchMembersOfCircle(dotYouClient, circleId);
    };



    return {
        fetchMembers: useQuery({
            queryKey: ['circleMembers', circleId],
            queryFn: () => fetchMembers({ circleId: circleId as string }),

            refetchOnWindowFocus: false,
            enabled: !!circleId,
        }),
    };
}
