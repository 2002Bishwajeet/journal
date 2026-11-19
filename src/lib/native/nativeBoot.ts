import { PHASE_PROGRESS, getBootProgress, reportBootError, subscribeBootProgress } from '@/lib/bootProgress';
import { installSealedStorage, installSecureStorage } from './secureStorage';
import { removePlaintextLeftovers } from './plaintextLeftovers';
import { installCloseFlush } from './closeFlush';
import { usesEncryptedDatabase } from '@/lib/db/databaseKey';

/**
 * The native app's boot before it renders (#1429): the Homebase sign-in from the OS keychain,
 * read before anything asks for it. Without it the app would boot signed out, so a keychain
 * error is a boot error (false), and main.tsx shows the boot error screen, whose Retry
 * reloads. Then what older builds left in plaintext goes, and a closing desktop window waits
 * for the unload copies. `showBootError` shows that screen before the app, for the passphrase.
 */
export async function prepareNativeBoot(showBootError: () => void): Promise<boolean> {
    try {
        if ((await installSecureStorage()) === 'passphrase' && !(await unsealWithPassphrase(showBootError))) return false;
    } catch (err) {
        console.error('[boot] Could not read the sign-in from the keychain:', err);
        reportBootError(err instanceof Error ? err : new Error(`Couldn't read the sign-in from the system keychain: ${String(err)}`));
        return false;
    }
    // Android with encryption off (#1435) keeps the sign-in in the keychain, the rest plain.
    if (!usesEncryptedDatabase()) return true;
    try {
        removePlaintextLeftovers();
    } catch (err) {
        console.warn('[boot] Could not remove the plaintext an older build left:', err);
    }
    void installCloseFlush();
    return true;
}

/**
 * A Linux without a keychain: the sign-in is sealed with a key from the passphrase, so the
 * database opens first, behind the passphrase screen, and the app renders only after: it never
 * reads the sign-in before it can, nor shows the user signed out. False when the database
 * can't be opened (getDatabase reported why).
 */
async function unsealWithPassphrase(showBootError: () => void): Promise<boolean> {
    const { getDatabase, isLeftoverSession } = await import('@/lib/db/pglite');
    try {
        await getDatabase();
    } catch (err) {
        if (!(err instanceof Error && err.name === 'PassphraseNeededError')) return false;
        showBootError();
        // Its Unlock opens the database; a wrong passphrase asks again.
        await new Promise<void>((resolve) => {
            const stop = subscribeBootProgress(() => {
                if (getBootProgress() < PHASE_PROGRESS['db-ready']) return;
                stop();
                resolve();
            });
        });
    }
    // The launch on the plain database an older build left asks no passphrase: that build's
    // plaintext sign-in is sealed on the next one.
    if (!isLeftoverSession()) await installSealedStorage();
    return true;
}
