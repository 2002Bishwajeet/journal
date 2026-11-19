import { appLockOn } from '@/lib/native/bridge';
import { loadStoreKey } from './databaseKey';

/**
 * AES-GCM with the store key (#1429), for what the native app keeps outside its encrypted
 * database: the query cache and the unload copies of edits. Loaded only in the native app.
 * A sealed value is its 12-byte nonce, then the ciphertext; `label` (the store's key) is the
 * associated data, so a value can't be moved to another key. Both throw without the key
 * (the app is locked, or its keychain entry is gone) and on another key's value.
 */
const NONCE_LENGTH = 12;

// With the app lock on, only the database's unlock asks the owner (#1363).
const storeKey = () => loadStoreKey(!appLockOn());

export async function seal(plain: Uint8Array<ArrayBuffer>, label: string): Promise<Uint8Array<ArrayBuffer>> {
    const key = await storeKey();
    const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: new TextEncoder().encode(label) }, key, plain);
    const sealed = new Uint8Array(NONCE_LENGTH + data.byteLength);
    sealed.set(nonce);
    sealed.set(new Uint8Array(data), NONCE_LENGTH);
    return sealed;
}

export async function unseal(sealed: Uint8Array<ArrayBuffer>, label: string): Promise<Uint8Array<ArrayBuffer>> {
    const key = await storeKey();
    const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: sealed.subarray(0, NONCE_LENGTH), additionalData: new TextEncoder().encode(label) },
        key,
        sealed.subarray(NONCE_LENGTH),
    );
    return new Uint8Array(plain);
}
