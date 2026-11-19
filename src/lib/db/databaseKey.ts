import { nativePlatform } from '../native';

/**
 * The native app, desktop (#1361) and phone (#1364), opens its database through pglite-cipher,
 * always, in its own IndexedDB store. The web stays plain. A page that only claims a native
 * platform (e2e fakes it with __JOURNAL_NATIVE__) has no Tauri to ask for the key.
 */
export function usesEncryptedDatabase(): boolean {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return false;
  return nativePlatform() !== null;
}

/**
 * The encrypted database's IndexedDB store (#1361): the databases `journal-data.a` and
 * `.b`, the pair a data key rotation needs. The name says nothing about what it holds.
 */
export const ENCRYPTED_STORE = 'journal-data';

/** Set when Lock now or the lock timeout locked this window (#1363); Unlock clears it. */
export const LOCKED_SESSION_KEY = 'journal-app-locked';

/** The keychain entry is gone after this device made a key: the encrypted database can't be opened (#1362). */
export class DatabaseKeyMissingError extends Error {
  constructor() {
    super('The key to your local notes is missing from the system keychain');
    this.name = 'DatabaseKeyMissingError';
  }
}

/**
 * The app lock is on (#1363): `cancelled` or `failed` when Touch ID, Windows Hello, Face ID or a fingerprint didn't
 * confirm the owner, `locked` after Lock now or the lock timeout, before anyone asked.
 */
export class DatabaseLockedError extends Error {
  readonly reason: 'cancelled' | 'failed' | 'locked';

  constructor(reason: 'cancelled' | 'failed' | 'locked') {
    super('Journal is locked');
    this.name = 'DatabaseLockedError';
    this.reason = reason;
  }
}

/**
 * A Linux without a keychain (#1363): the key comes from a passphrase the page hasn't got yet,
 * or (`wrong`) the one it was given didn't open the database.
 */
export class PassphraseNeededError extends Error {
  /** No encrypted database yet, so this passphrase makes it. */
  readonly isNew: boolean;
  readonly wrong: boolean;

  constructor(isNew: boolean, wrong = false) {
    super('Enter the passphrase for your local notes');
    this.name = 'PassphraseNeededError';
    this.isNew = isNew;
    this.wrong = wrong;
  }
}

/** OWASP's count for PBKDF2-HMAC-SHA256. */
export const PASSPHRASE_ITERATIONS = 600_000;

/** The 32-byte key a passphrase gives with this device's salt. */
export async function derivePassphraseKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PASSPHRASE_ITERATIONS }, material, 256);
  return new Uint8Array(bits);
}

/** Kept in memory only, for this page: a reload asks again. */
let passphrase: string | null = null;
let passphraseDevice = false;

export function setPassphrase(value: string): void {
  passphrase = value;
  // What a wrong passphrase's key sealed isn't for this one.
  awaitNextStoreKey();
}

/** This device's key comes from a passphrase, so the worker's WrongKeyError means a wrong one. */
export function usesPassphrase(): boolean {
  return passphraseDevice;
}

type KeyAnswer = { key: number[] } | 'missing' | { passphrase: number[] } | { locked: 'cancelled' | 'failed' };

/** The 32 key bytes, from the OS keychain or the passphrase. */
async function loadKeyBytes(): Promise<Uint8Array<ArrayBuffer>> {
  // Locked in this window: the lock screen shows, and only Unlock asks the owner.
  if (sessionStorage.getItem(LOCKED_SESSION_KEY) !== null) throw new DatabaseLockedError('locked');
  const { invoke } = await import('@tauri-apps/api/core');
  const answer = await invoke<KeyAnswer>('plugin:journal-db-key|database_key');
  if (answer === 'missing') throw new DatabaseKeyMissingError();
  if ('locked' in answer) throw new DatabaseLockedError(answer.locked);
  if ('passphrase' in answer) {
    passphraseDevice = true;
    if (passphrase === null) {
      const { databaseExists } = await import('./pglite-migrate');
      throw new PassphraseNeededError(!(await databaseExists([`${ENCRYPTED_STORE}.a`])));
    }
    return derivePassphraseKey(passphrase, Uint8Array.from(answer.passphrase));
  }
  return Uint8Array.from(answer.key);
}

/** The keys of the web view's other stores, from loadDatabaseKey's latest attempt; before its first, ones that wait for it. */
type LocalKeys = { store: CryptoKey; authSecrets: CryptoKey };
let localKeys!: Promise<LocalKeys>;
let settleLocalKeys!: (keys: Promise<LocalKeys>) => void;
function awaitNextStoreKey(): void {
  localKeys = new Promise((resolve) => { settleLocalKeys = resolve; });
  // Its error reaches whoever waits; nobody waiting is fine.
  localKeys.catch(() => {});
}
awaitNextStoreKey();

/** An AES-GCM key from the database's key bytes (#1429), kept apart from the database's by HKDF's `info`. */
async function deriveKey(bytes: Uint8Array<ArrayBuffer>, info: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', bytes, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(info) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

const deriveLocalKeys = async (bytes: Uint8Array<ArrayBuffer>): Promise<LocalKeys> => ({
  store: await deriveKey(bytes, 'journal-local-stores'),
  authSecrets: await deriveKey(bytes, 'journal-auth-secrets'),
});

/**
 * The database's key from the OS keychain (src-tauri/src/db_key.rs), imported as a
 * non-extractable key for the PGlite worker. Null where the database is plain; there
 * neither Tauri nor pglite-cipher is loaded. With the app lock on, the keychain answers
 * only after Touch ID, Windows Hello, Face ID or a fingerprint.
 */
export async function loadDatabaseKey(): Promise<CryptoKey | null> {
  if (!usesEncryptedDatabase()) return null;
  const bytes = loadKeyBytes();
  const derived = bytes.then(deriveLocalKeys);
  derived.catch(() => {});
  settleLocalKeys(derived);
  localKeys = derived;
  await derived;
  const { importKek } = await import('pglite-cipher');
  // importKek zeroes the bytes once it has the key.
  return importKek(await bytes);
}

/**
 * The key that seals the query cache and the unload copies of edits (#1429, sealed.ts), from
 * the same keychain key. It never asks the keychain itself, so the owner sees one Touch ID or
 * Windows Hello prompt: it waits for the database's loadDatabaseKey and fails with it.
 */
export function loadStoreKey(): Promise<CryptoKey> {
  return localKeys.then((keys) => keys.store);
}

/**
 * The key that seals the Homebase sign-in on a Linux without a keychain (#1429,
 * secureStorage.ts), from the passphrase's key like the store key. Like it, it waits for the
 * database's loadDatabaseKey and fails with it.
 */
export function loadAuthSecretsKey(): Promise<CryptoKey> {
  return localKeys.then((keys) => keys.authSecrets);
}
