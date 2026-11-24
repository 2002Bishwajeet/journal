import { AppPermissionType } from '@homebase-id/js-lib/network';
import { useSecurityContext } from './securityContext/useSecurityContext';

const PEER_PERMISSIONS: number[] = [
    AppPermissionType.ReceiveDataFromOtherIdentitiesOnMyBehalf,
    AppPermissionType.SendDataToOtherIdentitiesOnMyBehalf,
];

/**
 * Whether Journal may make peer calls (#1494): without peer read or peer send on the app's
 * token, the host's own server refuses every one with a 403. `false` only when the
 * permissions loaded and hold neither key. `undefined` while they load (callers skip the
 * peer request, never the render). `true` when they could not be read: the server still
 * enforces, the gate only avoids doomed requests. With `needed` false it
 * makes no request and returns `undefined`.
 */
export function usePeerAccess(needed = true): boolean | undefined {
    // A signed-out guest (the public share page) or an own-host read needs no peer call, so no request
    const { data, isError } = useSecurityContext(undefined, needed).fetch;
    if (!data) return isError ? true : undefined;
    return data.permissionContext.permissionGroups
        .some((group) => group.permissionSet.keys.some((key) => PEER_PERMISSIONS.includes(key)));
}
