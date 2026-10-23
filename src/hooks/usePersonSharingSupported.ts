import { useQuery } from '@tanstack/react-query';
import { useDotYouClientContext } from '@/components/auth';
import { fetchServerVersion, supportsNamedIdentities } from '@/lib/homebase/serverVersion';

/**
 * Whether the owner's server can share a note with named identities (#681): undefined
 * while its version loads. A version that can't be read doesn't hide the option.
 */
export function usePersonSharingSupported(): boolean | undefined {
    const root = useDotYouClientContext().getRoot();
    const { data, isError } = useQuery({
        queryKey: ['server-version', root],
        queryFn: () => fetchServerVersion(root),
        staleTime: Infinity,
        retry: false,
    });
    if (isError) return true;
    return data === undefined ? undefined : supportsNamedIdentities(data);
}
