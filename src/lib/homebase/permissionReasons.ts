import type { TargetDriveAccessRequest } from "@homebase-id/js-lib/auth";
import { AppPermissionType, ContactConfig } from "@homebase-id/js-lib/network";
import { JOURNAL_DRIVE } from "@/lib/homebase/config";

export interface PermissionReason {
    label: string;
    reason: string;
}

// Why Journal asks for each permission key it requests (config.ts), in plain words.
const PERMISSION_REASONS: Partial<Record<number, PermissionReason>> = {
    [AppPermissionType.ReadConnections]: {
        label: "See your connections",
        reason: "Journal uses this to find notes that people share with you.",
    },
    [AppPermissionType.SendPushNotifications]: {
        label: "Send notifications",
        reason: "Journal tells you when someone shares a note with you.",
    },
    [AppPermissionType.SendDataToOtherIdentitiesOnMyBehalf]: {
        label: "Send notes to people",
        reason: "Journal sends the notes that you share to the people you choose.",
    },
    [AppPermissionType.ReceiveDataFromOtherIdentitiesOnMyBehalf]: {
        label: "Receive notes from people",
        reason: "Journal gets the notes and changes that people share with you.",
    },
    [AppPermissionType.ReadCircleMembers]: {
        label: "See your circles",
        reason: "Journal shows who is in a circle when you share a note.",
    },
};

// Keyed by drive alias: the journal drive and the contacts drive Journal reads.
const DRIVE_REASONS: Record<string, PermissionReason> = {
    [JOURNAL_DRIVE.alias]: {
        label: "Store your notes",
        reason: "Journal reads and saves your notes on your Homebase.",
    },
    [ContactConfig.ContactTargetDrive.alias]: {
        label: "See your contacts",
        reason: "Journal shows the names and photos of the people you share with.",
    },
};

const GENERIC_REASON = "A Journal feature needs this.";

export function describePermission(key: number): PermissionReason {
    return PERMISSION_REASONS[key] ?? { label: "Extra access", reason: GENERIC_REASON };
}

export function describeDrive(drive: TargetDriveAccessRequest): PermissionReason {
    return DRIVE_REASONS[drive.alias] ?? { label: drive.name.trim() || "Extra storage", reason: GENERIC_REASON };
}

/** A stable id for one set of missing permissions, so a dismissal applies to that set only. */
export function missingSetKey(permissions: number[], drives: TargetDriveAccessRequest[]): string {
    return [
        ...[...permissions].sort((a, b) => a - b).map(String),
        ...drives.map((d) => `${d.alias}:${d.type}:${d.permissions.reduce((a, b) => a + b, 0)}`).sort(),
    ].join(",");
}

/** Dismissed means this identity chose "Not now" for exactly this missing set. */
export function isPromptDismissed(
    dismissed: Record<string, string> | null,
    identity: string,
    setKey: string,
): boolean {
    return dismissed?.[identity] === setKey;
}
