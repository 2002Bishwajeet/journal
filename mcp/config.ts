import type { TargetDriveAccessRequest } from '@homebase-id/js-lib/auth';
import { DrivePermissionType } from '@homebase-id/js-lib/core';
import { JOURNAL_DRIVE, JOURNAL_DRIVE_ATTRIBUTES } from '@/lib/homebase/config';

// Fixed: same appId/slug in dev and prod, registered once per identity via `npm run mcp:login`.
export const JOURNAL_MCP_APP_ID = '9fdd7bae5e9c453e8858b775ec892aee';
// Permanent, like JOURNAL_APP_SLUG: the server never renames an app's slug.
export const JOURNAL_MCP_APP_SLUG = 'journal-mcp';
export const JOURNAL_MCP_APP_NAME = 'Journal MCP';

// The MCP app's own drive request: Read+Write on the same JOURNAL_DRIVE the app uses, but
// no React/Comment, no circle drives — an agent never needs those (#167). It still asks for the
// app's subscriptions and attributes: if its consent is the first to create the drive, the drive
// must not be left unable to carry share pushes (#848).
export const mcpDriveRequest: TargetDriveAccessRequest = {
    ...JOURNAL_DRIVE,
    name: 'Journal Notes',
    description: 'Notes you grant to AI agents in Journal → Settings → Agent access',
    permissions: [DrivePermissionType.Read, DrivePermissionType.Write],
    allowSubscriptions: true,
    attributes: JOURNAL_DRIVE_ATTRIBUTES,
    driveSlug: 'notes',
    driveTypeSlug: 'notes',
};
