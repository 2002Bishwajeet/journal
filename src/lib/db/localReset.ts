import { LEGACY_DATABASE, PLAIN_DATABASE, shutDownDatabase } from './pglite';
import { ENCRYPTED_STORE } from './databaseKey';

/**
 * Deletes an IndexedDB database. pglite-cipher's delete also waits out WebKit, which reports
 * a delete as blocked while the connection a closed worker had is still closing.
 */
export async function deleteLocalDatabase(name: string): Promise<void> {
  const { IndexedDbBackend } = await import('pglite-cipher');
  await new IndexedDbBackend(name).destroy();
}

/**
 * "Reset local data and sync again" (#1362), only ever the user's choice: deletes the desktop
 * app's encrypted database and the plain ones older builds left, then makes a new keychain
 * key if the old one is gone. The caller reloads, and the empty database syncs from Homebase.
 * Changes on this device that never synced are lost.
 */
export async function resetLocalData(): Promise<void> {
  await shutDownDatabase();
  for (const name of [`${ENCRYPTED_STORE}.a`, `${ENCRYPTED_STORE}.b`, PLAIN_DATABASE, LEGACY_DATABASE]) await deleteLocalDatabase(name);
  // After the delete: a new key next to the old store would never open it.
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('plugin:journal-db-key|reset_database_key');
}
