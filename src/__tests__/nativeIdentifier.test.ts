import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

describe('native app identifier', () => {
  const { identifier } = JSON.parse(read('src-tauri/tauri.conf.json')) as { identifier: string };

  it('is the App Store bundle id', () => {
    expect(identifier).toBe('com.biswa.journal');
  });

  it('matches the Android namespace, applicationId and MainActivity package', () => {
    const gradle = read('src-tauri/gen/android/app/build.gradle.kts');
    expect(gradle).toContain(`namespace = "${identifier}"`);
    expect(gradle).toContain(`applicationId = "${identifier}"`);
    const activity = read(
      `src-tauri/gen/android/app/src/main/java/${identifier.replaceAll('.', '/')}/MainActivity.kt`,
    );
    expect(activity).toMatch(new RegExp(`^package ${identifier.replaceAll('.', '\\.')}$`, 'm'));
  });
});
