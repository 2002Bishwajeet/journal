import { hasNativePlugin, isNativeApp, nativePlatform } from '@/lib/native';

/**
 * The billing Worker (#300) the desktop app checks license keys with. Read only here. Unset
 * (dev, forks, self-builds) turns off desktop's license screens, the trial and the paywall.
 * Store builds (iOS, Android) leave it unset: they sell in the store (native/AGENTS.md).
 */
export const BILLING_URL: string | null = import.meta.env.VITE_BILLING_URL || null;

/** True in the native app of a build with a billing Worker: the license key, trial and paywall run. */
export function licenseEnabled(): boolean {
    return BILLING_URL !== null && isNativeApp();
}

/**
 * True in a native app that sells itself: the store plugin (`journal-iap`) on iOS and Android,
 * a billing Worker on desktop. It turns on the trial, the paywall and Settings → Purchase; the
 * entitlement (`@premium`) decides what they show.
 */
export function billingEnabled(): boolean {
    const platform = nativePlatform();
    if (platform === 'ios' || platform === 'android') return hasNativePlugin('journal-iap');
    return licenseEnabled();
}

/** Opens the native app's paywall (the read-only banner's Unlock, #1176). Does nothing on the web. */
export function openPaywall(): void {
    import('@premium')
        .then((m) => m.openPaywall())
        .catch((err: unknown) => console.error('[billing] Failed to open the paywall:', err));
}

/** The website's download page (#305), for the web's "Get the desktop app" link. */
export const DOWNLOAD_URL = 'https://journal.cloudx.run/landing/download';
