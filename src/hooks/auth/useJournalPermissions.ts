import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useDotYouClientContext } from "@/components/auth";
import { useMissingPermissions } from "@/hooks/auth/useMissingPermissions";
import { journalDriveRequest } from "@/hooks/auth/useYouAuthAuthorization";
import { useNoteCounts } from "@/hooks/useNotes";
import {
    BASE_PERMISSIONS,
    COLLABORATION_PERMISSIONS,
    CONTACT_TARGET_DRIVE_REQUEST,
    JOURNAL_APP_ID,
} from "@/lib/homebase/config";
import {
    describeDrive,
    describePermission,
    isPromptDismissed,
    missingSetKey,
} from "@/lib/homebase/permissionReasons";
import { PERMISSION_PROMPT_DISMISSED_KEY, readJson, writeJson } from "@/lib/storage";

const BASE_DRIVES = [journalDriveRequest];
const COLLAB_DRIVES = [journalDriveRequest, CONTACT_TARGET_DRIVE_REQUEST];

/**
 * The permissions Journal still needs from this identity, each with a plain reason,
 * and the "Not now" state: a dismissal holds for one identity and one missing set.
 */
export function useJournalPermissions() {
    const queryClient = useQueryClient();
    const identity = useDotYouClientContext().getHostIdentity();
    const isCollaborator = useNoteCounts().collaborative > 0;
    const missing = useMissingPermissions({
        appId: JOURNAL_APP_ID,
        drives: isCollaborator ? COLLAB_DRIVES : BASE_DRIVES,
        circleDrives: isCollaborator ? COLLAB_DRIVES : [],
        permissions: isCollaborator ? COLLABORATION_PERMISSIONS : BASE_PERMISSIONS,
    });
    const [dismissed, setDismissed] = useState(() =>
        readJson<Record<string, string>>(PERMISSION_PROMPT_DISMISSED_KEY),
    );

    if (!missing) return null;

    const setKey = missingSetKey(missing.permissions, missing.drives);
    return {
        url: missing.url,
        items: [
            ...missing.permissions.map((key) => ({ id: `p${key}`, ...describePermission(key) })),
            ...missing.drives.map((drive) => ({ id: drive.alias, ...describeDrive(drive) })),
        ],
        isDismissed: isPromptDismissed(dismissed, identity, setKey),
        dismiss: () => {
            const next = { ...dismissed, [identity]: setKey };
            writeJson(PERMISSION_PROMPT_DISMISSED_KEY, next);
            setDismissed(next);
        },
        // The grant happens on the owner console; refetch the context when the user returns.
        onGrant: () => queryClient.invalidateQueries({ queryKey: ["security-context"], exact: false }),
    };
}
