import { del } from 'idb-keyval';
import { LEGACY_DATABASE, PLAIN_DATABASE, shutDownDatabase } from './pglite';
import { ENCRYPTED_STORE, usesPassphrase } from './databaseKey';
import { QUERY_CACHE_KEY } from '@/lib/queryCache';
import { removeUnsavedEdits, unsavedEditDocIds } from '@/lib/yjs/unsavedEdits';

/**
 * Deletes an IndexedDB database. pglite-cipher's delete also waits out WebKit, which reports
 * a delete as blocked while the connection a closed worker had is still closing.
 */
export async function deleteLocalDatabase(name: string): Promise<void> {
  const { IndexedDbBackend } = await import('pglite-cipher');
  await new IndexedDbBackend(name).destroy();
}

/**
 * "Reset local data and sync again" (#1362), only ever the user's choice: deletes the native
 * app's encrypted database, the plain ones older builds left, the sealed query cache and the sealed unload copies of edits (and, with a passphrase, the sealed sign-in), then makes a new keychain
 * key if the old one is gone. The caller reloads, and the empty database syncs from Homebase.
 * Changes on this device that never synced are lost.
 */
export async function resetLocalData(): Promise<void> {
  await shutDownDatabase();
  for (const name of [`${ENCRYPTED_STORE}.a`, `${ENCRYPTED_STORE}.b`, PLAIN_DATABASE, LEGACY_DATABASE]) await deleteLocalDatabase(name);
  // Sealed with the old key: the new one couldn't open them (#1429).
  await del(QUERY_CACHE_KEY);
  for (const docId of unsavedEditDocIds()) await removeUnsavedEdits(docId);
  // So is a Linux's sign-in, with the old passphrase's key: the next launch signs in again.
  if (usesPassphrase()) (await import('@/lib/native/secureStorage')).clearSecureStorage();
  // After the delete: a new key next to the old store would never open it.
  const { invoke } = await import('@tauri-apps/api/core');
  await invoke('plugin:journal-db-key|reset_database_key');
}
