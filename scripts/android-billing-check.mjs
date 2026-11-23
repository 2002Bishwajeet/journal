// #1175: Play warns about a bundle whose manifest lacks the Play Billing Library's version
// meta-data, which the library's own manifest adds. A release build with native/ (whose
// :journal-premium sells through Play) checks that its merged manifests still carry it.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const BILLING_META_DATA = 'com.google.android.play.billingclient.version';

/** The merged release manifests under `app` (src-tauri/gen/android/app). */
export function releaseManifests(app) {
  const dir = join(app, 'build', 'intermediates');
  let files;
  try {
    files = readdirSync(dir, { recursive: true }).map(String);
  } catch {
    return [];
  }
  return files
    .filter((f) => /merged_manifests?[\\/]/.test(f) && /release/i.test(f) && f.endsWith('AndroidManifest.xml'))
    .map((f) => join(dir, f));
}

/** Throws unless the build has a merged release manifest and each one names the billing version. */
export function checkBillingMetaData(app) {
  const manifests = releaseManifests(app);
  if (manifests.length === 0) throw new Error(`No merged release manifest under ${join(app, 'build', 'intermediates')}`);
  const missing = manifests.filter((f) => !readFileSync(f, 'utf8').includes(`android:name="${BILLING_META_DATA}"`));
  if (missing.length > 0) throw new Error(`${BILLING_META_DATA} is missing from ${missing.join(', ')}`);
}
