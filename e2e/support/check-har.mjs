#!/usr/bin/env node
// Layer 2 (#202): exits 1, naming file + entry, if a HAR under e2e/har still
// holds a credential. Runs first in `npm run e2e:recorded`, so every PR run
// enforces it. Usage: node e2e/support/check-har.mjs
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const HAR_DIR = path.resolve(import.meta.dirname, '..', 'har');
export const SENSITIVE_HEADERS = ['authorization', 'cookie', 'set-cookie', 'bx0900'];
const SENSITIVE_VALUE = /Bearer\s|BX0900/i;

/** Every .har file under `dir`. */
export function harFiles(dir = HAR_DIR) {
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { recursive: true })
        .filter((file) => file.endsWith('.har'))
        .map((file) => path.join(dir, file));
}

/** The recording session's token (BX0900) and shared secret (APSS), from whichever storage states exist. */
export function sessionSecrets(files = [
    path.resolve(import.meta.dirname, '..', '.auth', 'live.json'),
    path.join(HAR_DIR, 'replay-auth.json'),
]) {
    return files
        .filter((file) => existsSync(file))
        .flatMap((file) => JSON.parse(readFileSync(file, 'utf8')).origins.flatMap((o) => o.localStorage))
        .filter(({ name, value }) => (name === 'BX0900' || name === 'APSS') && value)
        .map(({ value }) => value);
}

function* strings(value) {
    if (typeof value === 'string') yield value;
    else if (value && typeof value === 'object') for (const child of Object.values(value)) yield* strings(child);
}

/** Why each entry of `har` fails the check, as `{ index, reason }`. */
export function findHarProblems(har, secrets = []) {
    const problems = [];
    har.log.entries.forEach((entry, index) => {
        for (const part of [entry.request, entry.response]) {
            for (const { name } of part.headers ?? []) {
                if (SENSITIVE_HEADERS.includes(name.toLowerCase())) problems.push({ index, reason: `header "${name}"` });
            }
            if (part.cookies?.length) problems.push({ index, reason: 'non-empty cookies' });
        }
        const values = [...strings(entry)];
        if (values.some((s) => SENSITIVE_VALUE.test(s))) problems.push({ index, reason: `a value matching ${SENSITIVE_VALUE}` });
        if (values.some((s) => secrets.some((secret) => s.includes(secret)))) {
            problems.push({ index, reason: 'the recording session\'s literal token/secret' });
        }
    });
    return problems;
}

function main() {
    const files = harFiles();
    const secrets = sessionSecrets();
    let failed = false;
    for (const file of files) {
        for (const { index, reason } of findHarProblems(JSON.parse(readFileSync(file, 'utf8')), secrets)) {
            console.error(`${path.relative(process.cwd(), file)} entry ${index}: ${reason}`);
            failed = true;
        }
    }
    if (failed) {
        console.error('HAR scrub check failed — run node e2e/support/scrub-har.mjs, or re-record (e2e/har/README.md).');
        process.exit(1);
    }
    console.log(`check-har: ${files.length} HAR file(s) clean.`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
