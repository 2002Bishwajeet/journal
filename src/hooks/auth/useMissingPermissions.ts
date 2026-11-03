import { useDotYouClientContext } from "@/components/auth";
import { getExtendAppRegistrationParams, type TargetDriveAccessRequest } from "@homebase-id/js-lib/auth";
import { drivesEqual, getUniqueDrivesWithHighestPermission, stringifyToQueryParams } from "@homebase-id/js-lib/helpers";
import type { AppPermissionType } from "@homebase-id/js-lib/network";
import { JOURNAL_APP_ID } from "@/lib/homebase/config";
import { useSecurityContext } from "../securityContext/useSecurityContext";
import { journalDriveRequest } from "./useYouAuthAuthorization";

const getExtendAppRegistrationUrl = (
    host: string,
    appId: string,
    drives: TargetDriveAccessRequest[],
    circleDrives: TargetDriveAccessRequest[] | undefined,
    permissionKeys: number[] | undefined,
    returnUrl: string,
    circleOdinIds?: string[] | undefined,
) => {
    const params = getExtendAppRegistrationParams(
        appId,
        drives,
        circleDrives,
        permissionKeys,
        circleOdinIds,
        returnUrl
    );

    return `${host}/owner/appupdate?${stringifyToQueryParams(params)}`;
};

/**
 * The extend-permissions page for the journal drive's own settings (#870): its attributes and
 * "Allow subscriptions", which the owner console merges in. Unlike the missing-permission URL it
 * is built when the grant exists, and it asks for no other drive or permission.
 */
export const getJournalDriveFixUrl = (host: string, returnUrl: string) =>
    getExtendAppRegistrationUrl(host, JOURNAL_APP_ID, [journalDriveRequest], undefined, undefined, returnUrl);

export const useMissingPermissions = ({
    appId,
    drives,
    circleDrives,
    permissions,
    circleOdinIds,
    returnUrl,
}: {
    appId: string;
    drives: TargetDriveAccessRequest[];
    circleDrives?: TargetDriveAccessRequest[] | undefined;
    permissions: AppPermissionType[];
    circleOdinIds?: string[] | undefined;
    returnUrl?: string;
}) => {
    const dotyouClient = useDotYouClientContext();
    const host = dotyouClient.getRoot();
    const { data: context } = useSecurityContext().fetch;

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

        return !hasAccess;
    });

    const missingPermissions = permissions?.filter((key) => permissionKeys?.indexOf(key) === -1);

    if (missingDrives.length === 0 && missingPermissions.length === 0)
        return;

    const url = getExtendAppRegistrationUrl(
        host,
        appId,
        missingDrives,
        circleDrives,
        missingPermissions,
        returnUrl || window.location.href,
        circleOdinIds,
    );

    return { url, permissions: missingPermissions, drives: missingDrives };
};
