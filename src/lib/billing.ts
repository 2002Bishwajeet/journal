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
 * The mobile platforms whose store purchase has shipped: #1174 sells on iOS, #1175 turns Android
 * on. plugins.txt is one list for every platform, so `journal-iap` there (iOS first) must not
 * make Android sell before it can, which would lock users out with no way to buy.
 */
export const STORE_BILLING: Record<'ios' | 'android', boolean> = { ios: true, android: false };

/**
 * True in a native app that sells itself: the store plugin (`journal-iap`) on a store platform
 * that has shipped (STORE_BILLING), a billing Worker on desktop. It turns on the trial, the
 * paywall, Settings → Purchase and the entitlement (`@premium`), which decides what they show.
 * Otherwise (the web, dev and self-built apps, a store build before it sells) the app is unlocked.
 */
export function billingEnabled(): boolean {
    const platform = nativePlatform();
    if (platform === 'ios' || platform === 'android') return STORE_BILLING[platform] && hasNativePlugin('journal-iap');
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
