import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs release script, no types
import { BILLING_META_DATA, checkBillingMetaData } from '../../scripts/android-billing-check.mjs';

// #1175: the Android release build checks its merged manifest keeps Play Billing's version meta-data.
let app: string;

function manifest(path: string, meta: boolean) {
    const file = join(app, 'build/intermediates', path, 'AndroidManifest.xml');
    mkdirSync(join(file, '..'), { recursive: true });
    const metaData = meta ? `<meta-data android:name="${BILLING_META_DATA}" android:value="9.1.0" />` : '';
    writeFileSync(file, `<manifest><application>${metaData}</application></manifest>`);
}

afterEach(() => rmSync(app, { recursive: true, force: true }));

describe('checkBillingMetaData', () => {
    it('should pass when every merged release manifest has the billing version', () => {
        app = mkdtempSync(join(tmpdir(), 'billing-check-'));
        manifest('merged_manifest/universalRelease/processUniversalReleaseMainManifest', true);
        manifest('merged_manifests/universalRelease/processUniversalReleaseManifest', true);
        // A debug manifest isn't the release build's.
        manifest('merged_manifest/universalDebug/processUniversalDebugMainManifest', false);
        expect(() => checkBillingMetaData(app)).not.toThrow();
    });

    it('should fail when a merged release manifest lacks it', () => {
        app = mkdtempSync(join(tmpdir(), 'billing-check-'));
        manifest('merged_manifest/universalRelease/processUniversalReleaseMainManifest', false);
        expect(() => checkBillingMetaData(app)).toThrow(BILLING_META_DATA);
    });

    it('should fail when the build left no merged release manifest', () => {
        app = mkdtempSync(join(tmpdir(), 'billing-check-'));
        expect(() => checkBillingMetaData(app)).toThrow('No merged release manifest');
    });
});
