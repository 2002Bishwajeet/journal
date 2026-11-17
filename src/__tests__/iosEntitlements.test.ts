/**
 * #1326: iOS builds shipped without Associated Domains, so journal.cloudx.run
 * links did not open the app. XcodeGen rewrote the copied entitlements file
 * empty and the premium targets script then added only the App Group.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  APP_GROUP,
  ASSOCIATED_DOMAIN,
  missingEntitlements,
  // @ts-expect-error -- plain .mjs build script, no types
} from '../../scripts/ios-entitlements.mjs';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const plist = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>\n${body}\n</dict>\n</plist>\n`;
const array = (key: string, value: string) => `\t<key>${key}</key>\n\t<array>\n\t\t<string>${value}</string>\n\t</array>`;
const BOTH = [ASSOCIATED_DOMAIN, APP_GROUP];

describe('iOS entitlements check', () => {
  it('passes the repo entitlements file, which has Associated Domains', () => {
    expect(missingEntitlements(read('src-tauri/ios/journal_iOS/journal_iOS.entitlements'), [ASSOCIATED_DOMAIN])).toEqual([]);
  });

  it('passes a file with both keys, as the targets script and codesign write it', () => {
    const merged = plist(`${array(ASSOCIATED_DOMAIN[0], ASSOCIATED_DOMAIN[1])}\n${array(APP_GROUP[0], APP_GROUP[1])}`);
    expect(missingEntitlements(merged, BOTH)).toEqual([]);
    // codesign -d --entitlements - --xml prints it on one line.
    expect(missingEntitlements(merged.replace(/\s*\n\s*/g, ''), BOTH)).toEqual([]);
  });

  it('fails the file XcodeGen writes, and the one build 2845 shipped with', () => {
    expect(missingEntitlements(plist(''), BOTH)).toEqual([
      'com.apple.developer.associated-domains: applinks:journal.cloudx.run',
      'com.apple.security.application-groups: group.id.biswa.journal',
    ]);
    expect(missingEntitlements(plist(array(APP_GROUP[0], APP_GROUP[1])), BOTH)).toEqual([
      'com.apple.developer.associated-domains: applinks:journal.cloudx.run',
    ]);
  });

  it('does not take another domain or a value under another key', () => {
    expect(missingEntitlements(plist(array(ASSOCIATED_DOMAIN[0], 'applinks:other.example')), [ASSOCIATED_DOMAIN])).toHaveLength(1);
    expect(missingEntitlements(plist(array('com.apple.developer.other', ASSOCIATED_DOMAIN[1])), [ASSOCIATED_DOMAIN])).toHaveLength(1);
  });

  it('copies the entitlements back after XcodeGen, then checks them after the targets step', () => {
    const script = read('scripts/ios-project.mjs');
    const order = ["run('xcodegen'", 'cpSync(`src-tauri/ios/${ENTITLEMENTS}`', "run('npm', ['run', 'native:ios:targets'])", 'checkEntitlements('].map((s) =>
      script.indexOf(s),
    );
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('macOS Universal Links (#1342)', () => {
  const entitlements = read('src-tauri/macos-release.entitlements');
  const string = (key: string) => entitlements.match(new RegExp(`<key>${key.replaceAll('.', '\\.')}</key>\\s*<string>([^<]*)</string>`))?.[1];

  it('signs the release app with Associated Domains for the AASA app ID', () => {
    expect(missingEntitlements(entitlements, [ASSOCIATED_DOMAIN])).toEqual([]);
    const aasa = JSON.parse(read('public/.well-known/apple-app-site-association'));
    expect(aasa.applinks.details[0].appIDs).toContain(string('com.apple.application-identifier'));
    expect(string('com.apple.application-identifier')).toBe(`${string('com.apple.developer.team-identifier')}.com.biswa.journal`);
  });

  it('uses the entitlements and embeds the profile only through the release config', () => {
    const config = JSON.parse(read('src-tauri/tauri.macos-release.conf.json')).bundle.macOS;
    expect(config).toEqual({
      entitlements: 'macos-release.entitlements',
      files: { 'embedded.provisionprofile': 'target/embedded.provisionprofile' },
    });
    // Local and dev builds: no entitlement, which a build without the profile can't have.
    expect(JSON.parse(read('src-tauri/tauri.macos.conf.json')).bundle.macOS.entitlements).toBeUndefined();
    expect(JSON.parse(read('src-tauri/tauri.conf.json')).bundle.macOS?.entitlements).toBeUndefined();
  });

  it('fetches the profile before the macOS release build and checks the signed app after it', () => {
    const workflow = read('.github/workflows/desktop-release.yml');
    expect(workflow).toContain('args: --target universal-apple-darwin --config src-tauri/tauri.macos-release.conf.json');
    const order = [
      'node scripts/asc-release.mjs profile --mac',
      '--out src-tauri/target/embedded.provisionprofile',
      'uses: tauri-apps/tauri-action',
      '"$app/Contents/embedded.provisionprofile"',
      'codesign -d --entitlements - --xml "$app"',
      'node scripts/ios-entitlements.mjs --macos',
    ].map((s) => workflow.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});

describe('Android app links', () => {
  it('verifies journal.cloudx.run share, save and open links', () => {
    const manifest = read('src-tauri/gen/android/app/src/main/AndroidManifest.xml');
    const filter = manifest.match(/<intent-filter android:autoVerify="true" >([\s\S]*?)<\/intent-filter>/)?.[1] ?? '';
    for (const data of [
      'android:scheme="https"',
      'android:host="journal.cloudx.run"',
      'android:path="/save-shared"',
      'android:path="/open-shared"',
      'android:pathPattern="/share/..*/..*"',
    ]) {
      expect(filter).toContain(`<data ${data} />`);
    }
  });
});
