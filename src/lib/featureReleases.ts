/**
 * Features that count as an update for the native app's license (#301): the feature key and
 * the day it ships (YYYY-MM-DD, the `__BUILD_DATE__` of the release that brings it). Wrap the
 * feature in `<RenewForUpdate feature="...">`; a license whose updates ended before that day
 * shows "Renew to get this update" in its place. A feature not listed here is never locked.
 */
export const FEATURE_RELEASES: Record<string, string> = {};
