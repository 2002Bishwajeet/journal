import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const RES = 'src-tauri/gen/android/app/src/main/res';

describe('android app config', () => {
  it('has an adaptive launcher icon with a monochrome layer for themed icons', () => {
    for (const icon of ['ic_launcher', 'ic_launcher_round']) {
      const xml = read(`${RES}/mipmap-anydpi-v26/${icon}.xml`);
      expect(xml).toContain('<monochrome android:drawable="@drawable/ic_launcher_monochrome" />');
      expect(xml).toContain('<foreground android:drawable="@drawable/ic_launcher_foreground" />');
    }
  });

  it('shows the splash in the app background colour, light and dark', () => {
    const theme = read(`${RES}/values-v31/themes.xml`);
    expect(theme).toContain('<item name="android:windowSplashScreenBackground">@color/splash_background</item>');
    expect(theme).toContain('<item name="android:windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>');
    expect(read(`${RES}/values/colors.xml`)).toContain('<color name="splash_background">#FFFDFCF8</color>');
    expect(read(`${RES}/values-night/colors.xml`)).toContain('<color name="splash_background">#FF1C1B1A</color>');
  });

  it('is labelled Journal+', () => {
    expect(read(`${RES}/values/strings.xml`)).toContain('<string name="app_name">"Journal+"</string>');
  });

  it('signs release builds with an upload key read from outside the repo', () => {
    const gradle = read('src-tauri/gen/android/app/build.gradle.kts');
    expect(gradle).toContain('System.getenv("JOURNAL_ANDROID_UPLOAD_KEY")');
    expect(gradle).toContain('signingConfig = signingConfigs.findByName("upload")');
    const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' });
    expect(tracked).not.toMatch(/\.(jks|keystore)$|journal-upload\.properties/m);
  });

  it('builds the release bundle with the git commit count as versionCode', () => {
    const script = read('scripts/android-release.mjs');
    expect(script).toContain("'rev-list', '--count', 'HEAD'");
    expect(script).toContain("'--aab'");
    expect(script).toContain('bundle: { android: { versionCode } }');
  });
});
