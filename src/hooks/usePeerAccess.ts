import { AppPermissionType } from '@homebase-id/js-lib/network';
import { useSecurityContext } from './securityContext/useSecurityContext';

const PEER_PERMISSIONS: number[] = [
    AppPermissionType.ReceiveDataFromOtherIdentitiesOnMyBehalf,
    AppPermissionType.SendDataToOtherIdentitiesOnMyBehalf,
];

/**
 * Whether Journal may make peer calls (#1494): without peer read or peer send on the app's
 * token, the host's own server refuses every one with a 403. `undefined` while the
 * permissions load; `false` when they could not be read.
 */
export function usePeerAccess(): boolean | undefined {
    const { data, isError } = useSecurityContext().fetch;
    if (!data) return isError ? false : undefined;
    return data.permissionContext.permissionGroups
        .some((group) => group.permissionSet.keys.some((key) => PEER_PERMISSIONS.includes(key)));
}
