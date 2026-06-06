import { hasDebugFlag } from '@homebase-id/js-lib/helpers';

/**
 * Quiet debug-level console output in production unless the Homebase debug flag
 * is set (localStorage). console.error / warn / info are left intact.
 *
 * Imported for its side effect at the very top of main.tsx so it runs before any
 * other module's import-time logging.
 */
if (!import.meta.env.DEV && !hasDebugFlag()) {
    const noop = () => {};
    console.log = noop;
    console.debug = noop;
}
