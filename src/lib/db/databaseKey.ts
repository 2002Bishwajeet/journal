import { nativePlatform } from '../native';

/**
 * The desktop app opens its database through pglite-cipher (#1361), always, in its own
 * IndexedDB store. The web stays plain, and mobile follows in #1364. A page that only
 * claims a desktop platform (e2e fakes it with __JOURNAL_NATIVE__) has no Tauri to ask for the key.
 */
export function usesEncryptedDatabase(): boolean {
  if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) return false;
  const platform = nativePlatform();
  return platform === 'macos' || platform === 'windows' || platform === 'linux';
}

/** The keychain entry is gone after this device made a key: the encrypted database can't be opened (#1362). */
export class DatabaseKeyMissingError extends Error {
  constructor() {
    super('The key to your local notes is missing from the system keychain');
    this.name = 'DatabaseKeyMissingError';
  }
}

/**
 * The database's key from the OS keychain (src-tauri/src/db_key.rs), imported as a
 * non-extractable key for the PGlite worker. Null where the database is plain; there
 * neither Tauri nor pglite-cipher is loaded.
 */
export async function loadDatabaseKey(): Promise<CryptoKey | null> {
  if (!usesEncryptedDatabase()) return null;
  const { invoke } = await import('@tauri-apps/api/core');
  const answer = await invoke<{ key: number[] } | 'missing'>('plugin:journal-db-key|database_key');
  if (answer === 'missing') throw new DatabaseKeyMissingError();
  const { importKek } = await import('pglite-cipher');
  // importKek zeroes the bytes once it has the key.
  return importKek(Uint8Array.from(answer.key));
}
