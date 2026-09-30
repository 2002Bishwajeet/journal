#!/usr/bin/env node
// Layer 2 (#202): strips credentials from the HARs `npm run e2e:record` wrote,
// in place. check-har.mjs then verifies the result. Usage: node e2e/support/scrub-har.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { HAR_DIR, SENSITIVE_HEADERS, harFiles, sessionSecrets } from './check-har.mjs';

const APP_HOST = 'e2e.dotyou.cloud:4443';
// CORS lists of header *names*; odin-core's expose list names BX0900, which
// check-har's value pattern would flag. Replay never needs those names.
const HEADER_NAME_LIST = /^access-control-(allow|expose)-headers$/i;

/**
 * Keeps only entries to `hosts`; drops credential headers (by name, or any
 * carrying a secret), their names from CORS header lists, and all cookies.
 */
export function scrubHar(har, { hosts, secrets }) {
    const keep = ({ name, value }) =>
        !SENSITIVE_HEADERS.includes(name.toLowerCase()) && !secrets.some((secret) => value.includes(secret));
    const unlist = ({ name, value }) => ({
        name,
        value: HEADER_NAME_LIST.test(name)
            ? value.split(',').filter((item) => !SENSITIVE_HEADERS.includes(item.trim().toLowerCase())).join(',')
            : value,
    });
    har.log.entries = har.log.entries.filter((entry) => hosts.includes(new URL(entry.request.url).host));
    for (const entry of har.log.entries) {
        for (const part of [entry.request, entry.response]) {
            part.headers = (part.headers ?? []).filter(keep).map(unlist);
            part.cookies = [];
        }
    }
    return har;
}

function main() {
    const { identity } = JSON.parse(readFileSync(path.join(HAR_DIR, 'meta.json'), 'utf8'));
    const secrets = sessionSecrets();
    for (const file of harFiles()) {
        const har = scrubHar(JSON.parse(readFileSync(file, 'utf8')), { hosts: [identity, APP_HOST], secrets });
        writeFileSync(file, `${JSON.stringify(har, null, 2)}\n`);
        console.log(`scrub-har: ${path.relative(process.cwd(), file)} (${har.log.entries.length} entries)`);
    }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
