import { useDotYouClientContext } from "@/components/auth";
import { getExtendAppRegistrationParams, type TargetDriveAccessRequest } from "@homebase-id/js-lib/auth";
import { getDrivesByType } from "@homebase-id/js-lib/core";
import { drivesEqual, getUniqueDrivesWithHighestPermission, stringifyToQueryParams } from "@homebase-id/js-lib/helpers";
import type { AppPermissionType } from "@homebase-id/js-lib/network";
import { useQuery } from "@tanstack/react-query";
import { useSecurityContext } from "../securityContext/useSecurityContext";

const getExtendAppRegistrationUrl = (
    host: string,
    appId: string,
    drives: TargetDriveAccessRequest[],
    circleDrives: TargetDriveAccessRequest[] | undefined,
    permissionKeys: number[],
    returnUrl: string,
    needsAllConnected?: boolean,
    circleOdinIds?: string[] | undefined,
) => {
    const params = getExtendAppRegistrationParams(
        appId,
        drives,
        circleDrives,
        permissionKeys,
        circleOdinIds || needsAllConnected,
        returnUrl
    );

    return `${host}/owner/appupdate?${stringifyToQueryParams(params)}`;
};

export const useMissingPermissions = ({
    appId,
    drives,
    circleDrives,
    permissions,
    needsAllConnected,
    circleOdinIds,
    returnUrl,
}: {
    appId: string;
    drives: TargetDriveAccessRequest[];
    circleDrives?: TargetDriveAccessRequest[] | undefined;
    permissions: AppPermissionType[];
    needsAllConnected?: boolean;
    circleOdinIds?: string[] | undefined;
    returnUrl?: string;
}) => {
    const dotYouClient = useDotYouClientContext();
    const host = dotYouClient.getRoot();
    const { data: context } = useSecurityContext().fetch;

    const driveTypes = [...new Set(drives.map((d) => d.type))];

    const { data: driveDefinitions } = useQuery({
        queryKey: ['drive-definitions', ...driveTypes],
        queryFn: async () => {
            const results = await Promise.all(
                driveTypes.map((type) => getDrivesByType(dotYouClient, type, 1, 100))
            );
            return results.flatMap((r) => r.results);
        },
        enabled: !!context && !!host,
        staleTime: 1000 * 60 * 10,
    });

    if (!context || !host) return;

    const driveGrants = context?.permissionContext.permissionGroups.flatMap(
        (group) => group.driveGrants
    );
    const uniqueDriveGrants = driveGrants ? getUniqueDrivesWithHighestPermission(driveGrants) : [];

    const permissionKeys = context?.permissionContext.permissionGroups.flatMap(
        (group) => group.permissionSet.keys
    );

    const missingDrives = drives.filter((drive) => {
        const matchingGrants = uniqueDriveGrants.filter((grant) =>
            drivesEqual(grant.permissionedDrive.drive, drive)
        );

        const requestingPermission = drive.permissions.reduce((a, b) => a + b, 0);
        const hasAccess = matchingGrants.some((grant) => {
            const allPermissions = grant.permissionedDrive.permission.reduce((a, b) => a + b, 0);
            return allPermissions >= requestingPermission;
        });

        if (!hasAccess) return true;

        if (driveDefinitions) {
            const def = driveDefinitions.find((d) => drivesEqual(d.targetDriveInfo, drive));
            if (def) {
                if (drive.allowSubscriptions && !def.allowSubscriptions) return true;
                if (drive.allowAnonymousRead && !def.allowAnonymousReads) return true;
            }
        }

        return false;
    });

    const missingPermissions = permissions?.filter((key) => permissionKeys?.indexOf(key) === -1);

    const hasAllConnectedCircle = context?.caller.isGrantedConnectedIdentitiesSystemCircle;
    const missingAllConnectedCircle = (needsAllConnected && !hasAllConnectedCircle) || false;
    if (missingDrives.length === 0 && missingPermissions.length === 0 && !missingAllConnectedCircle)
        return;

    const extendPermissionUrl = getExtendAppRegistrationUrl(
        host,
        appId,
        missingDrives,
        circleDrives,
        missingPermissions,
        returnUrl || window.location.href,
        missingAllConnectedCircle,
        circleOdinIds,
    );

    return extendPermissionUrl;
};
