import type { TargetDriveAccessRequest } from '@homebase-id/js-lib/auth';
import { DrivePermissionType } from '@homebase-id/js-lib/core';
import { JOURNAL_DRIVE } from '@/lib/homebase/config';

// Fixed: same appId/slug in dev and prod, registered once per identity via `npm run mcp:login`.
export const JOURNAL_MCP_APP_ID = '9fdd7bae5e9c453e8858b775ec892aee';
// Permanent, like JOURNAL_APP_SLUG: the server never renames an app's slug.
export const JOURNAL_MCP_APP_SLUG = 'journal-mcp';
export const JOURNAL_MCP_APP_NAME = 'Journal MCP';

// The MCP app's own drive request: Read+Write on the same JOURNAL_DRIVE the app uses, but
// no React/Comment, no subscriptions, no circle drives — an agent never needs those (#167).
export const mcpDriveRequest: TargetDriveAccessRequest = {
    ...JOURNAL_DRIVE,
    name: 'Journal Notes',
    description: 'Notes you grant to AI agents in Journal → Settings → Agent access',
    permissions: [DrivePermissionType.Read, DrivePermissionType.Write],
    driveSlug: 'notes',
    driveTypeSlug: 'notes',
};
