import { isNativeApp } from '@/lib/native';

/**
 * The billing Worker (#300) the native app checks license keys with. Read only here. Unset
 * (dev, forks, self-builds) turns off every license screen, the trial and the paywall.
 */
export const BILLING_URL: string | null = import.meta.env.VITE_BILLING_URL || null;

/** True in the native app of a build with a billing Worker: the license key, trial and paywall run. */
export function licenseEnabled(): boolean {
    return BILLING_URL !== null && isNativeApp();
}

/** The website's download page (#305), for the web's "Get the desktop app" link. */
export const DOWNLOAD_URL = 'https://journal.cloudx.run/landing/download';
