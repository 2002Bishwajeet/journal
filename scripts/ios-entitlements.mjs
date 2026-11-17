#!/usr/bin/env node
// Checks that an iOS entitlements plist has what Journal+ needs (#1326):
// Associated Domains for Universal Links (journal.cloudx.run links open the app)
// and, when native/ adds premium targets, the App Group they share with the app.
// scripts/ios-project.mjs runs it on the generated project, and ios-release.yml
// on the built app (`codesign -d --entitlements - --xml`):
//   node scripts/ios-entitlements.mjs <entitlements.plist>
// desktop-release.yml checks the signed macOS app the same way for Associated Domains
// only (#1342; the Mac app has no App Group):
//   node scripts/ios-entitlements.mjs --macos <entitlements.plist>
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const ASSOCIATED_DOMAIN = ['com.apple.developer.associated-domains', 'applinks:journal.cloudx.run'];
export const APP_GROUP = ['com.apple.security.application-groups', 'group.id.biswa.journal'];
// native/scripts/apple-targets.rb adds the App Group; without native/ there is none.
export const required = () => (existsSync('native/scripts/apple-targets.rb') ? [ASSOCIATED_DOMAIN, APP_GROUP] : [ASSOCIATED_DOMAIN]);

/** The `key: value` entries of `entries` that the plist's string arrays lack. */
export function missingEntitlements(xml, entries) {
  return entries
    .filter(([key, value]) => {
      const values = xml.match(new RegExp(`<key>${key.replaceAll('.', '\\.')}</key>\\s*<array>([\\s\\S]*?)</array>`))?.[1];
      return !values?.includes(`<string>${value}</string>`);
    })
    .map(([key, value]) => `${key}: ${value}`);
}

/** Exits the process with a message naming each missing entitlement. */
export function checkEntitlements(file, entries = required()) {
  const missing = missingEntitlements(readFileSync(file, 'utf8'), entries);
  if (missing.length > 0) {
    console.error(`${file} is missing entitlements (#1326):\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  console.log(`Entitlements OK: ${file}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--macos') checkEntitlements(process.argv[3], [ASSOCIATED_DOMAIN]);
  else checkEntitlements(process.argv[2]);
}
