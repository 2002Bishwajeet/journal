import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

// The two fixed ports of the native app's origin (#1308), read from the Rust constants.
const lib = read('src-tauri/src/lib.rs');
const port = (name: string) => Number(new RegExp(`^const ${name}: u16 = (\\d+);$`, 'm').exec(lib)?.[1]);
const PROD_PORT = port('PROD_PORT');
const DEV_PORT = port('DEV_PORT');
const ORIGINS = [`http://localhost:${PROD_PORT}`, `http://localhost:${DEV_PORT}`];

describe('native app ports', () => {
  it('gives release builds and every other build their own port below every ephemeral range', () => {
    expect(PROD_PORT).not.toBe(DEV_PORT);
    for (const p of [PROD_PORT, DEV_PORT]) {
      expect(p).toBeGreaterThanOrEqual(10000);
      expect(p).toBeLessThanOrEqual(32767);
    }
  });

  it('picks PROD_PORT only when the build sets JOURNAL_RELEASE_BUILD', () => {
    expect(lib).toContain('const PORT: u16 = port_for(option_env!("JOURNAL_RELEASE_BUILD"));');
    expect(read('.github/workflows/desktop-release.yml')).toContain("JOURNAL_RELEASE_BUILD: '1'");
  });

  it.each(['default', 'desktop', 'mobile'])('grants the %s capability to both origins', (name) => {
    const capability = JSON.parse(read(`src-tauri/capabilities/${name}.json`));
    expect(capability.remote.urls).toEqual(ORIGINS);
  });

  it('allows both origins on iOS, macOS and Android', () => {
    const plist = read('src-tauri/Info.plist');
    expect(plist).toMatch(/<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/);
    for (const origin of ORIGINS) expect(plist).toContain(origin);

    const activity = read('src-tauri/gen/android/app/src/main/java/com/biswa/journal/MainActivity.kt');
    expect(activity).toContain(`setOf(${ORIGINS.map((o) => `"${o}"`).join(', ')})`);
    const network = read('src-tauri/gen/android/app/src/main/res/xml/network_security_config.xml');
    expect(network).toContain('<domain includeSubdomains="false">localhost</domain>');
    for (const origin of ORIGINS) expect(network).toContain(origin);
  });
});
