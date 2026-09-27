#!/usr/bin/env node
// Generates the self-signed HTTPS cert the `live`/`live-setup` projects serve
// the app on (https://e2e.dotyou.cloud:4443). If E2E_CERT_DIR is set (CI, #203
// passes its per-run CA-signed leaf), those files are used as-is and nothing
// is generated.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const certDir = process.env.E2E_CERT_DIR
    ? path.resolve(process.env.E2E_CERT_DIR)
    : path.resolve(import.meta.dirname, '..', '.certs');
const keyPath = path.join(certDir, 'e2e.key');
const crtPath = path.join(certDir, 'e2e.crt');

if (process.env.E2E_CERT_DIR) {
    if (!existsSync(keyPath) || !existsSync(crtPath)) {
        throw new Error(`E2E_CERT_DIR is set but ${keyPath} / ${crtPath} are missing`);
    }
} else if (!existsSync(keyPath) || !existsSync(crtPath)) {
    mkdirSync(certDir, { recursive: true });
    execFileSync('openssl', [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '30',
        '-keyout', keyPath,
        '-out', crtPath,
        '-subj', '/CN=e2e.dotyou.cloud',
        '-addext', 'subjectAltName=DNS:e2e.dotyou.cloud',
    ], { stdio: 'inherit' });
}
