import { reportBootError } from '@/lib/bootProgress';
import { installSecureStorage } from './secureStorage';
import { removePlaintextLeftovers } from './plaintextLeftovers';
import { installCloseFlush } from './closeFlush';

/**
 * The native app's boot before it renders (#1429): the Homebase sign-in from the OS keychain,
 * read before anything asks for it. Without it the app would boot signed out, so a keychain
 * error is a boot error (false), and main.tsx shows the boot error screen, whose Retry
 * reloads. Then what older builds left in plaintext goes, and a closing desktop window waits
 * for the unload copies.
 */
export async function prepareNativeBoot(): Promise<boolean> {
    try {
        await installSecureStorage();
    } catch (err) {
        console.error('[boot] Could not read the sign-in from the keychain:', err);
        reportBootError(err instanceof Error ? err : new Error(`Couldn't read the sign-in from the system keychain: ${String(err)}`));
        return false;
    }
    try {
        removePlaintextLeftovers();
    } catch (err) {
        console.warn('[boot] Could not remove the plaintext an older build left:', err);
    }
    void installCloseFlush();
    return true;
}
