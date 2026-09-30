import { describe, it, expect } from 'vitest';
// @ts-expect-error -- plain ESM dev script, no type declarations
import { scrubHar } from '../../e2e/support/scrub-har.mjs';
// @ts-expect-error -- plain ESM dev script, no type declarations
import { findHarProblems } from '../../e2e/support/check-har.mjs';

const TOKEN = 'dG9rZW4tdGhhdC1tdXN0LW5ldmVyLWxlYWs=';
const IDENTITY = 'frodo.dotyou.cloud';

type Header = { name: string; value: string };

const entry = (url: string, requestHeaders: Header[] = [], responseHeaders: Header[] = []) => ({
    startedDateTime: '2026-01-01T00:00:00.000Z',
    request: { method: 'GET', url, headers: requestHeaders, cookies: [{ name: 'DY0810', value: 'x' }] },
    response: { status: 200, headers: responseHeaders, cookies: [], content: { text: '{}' } },
});

const recorded = () => ({
    log: {
        entries: [
            entry(
                `https://${IDENTITY}/api/apps/v1/auth/verifytoken`,
                [
                    { name: 'BX0900', value: TOKEN },
                    { name: 'Authorization', value: `Bearer ${TOKEN}` },
                    { name: 'x-forwarded', value: `wraps ${TOKEN}` },
                    { name: 'Accept', value: 'application/json' },
                ],
                [
                    { name: 'Set-Cookie', value: 'DY0810=abc' },
                    { name: 'access-control-expose-headers', value: 'SharedSecretEncryptedHeader64,BX0900,SUB32' },
                    { name: 'content-type', value: 'application/json' },
                ],
            ),
            entry('https://tracker.example/pixel'),
        ],
    },
});

describe('scrubHar', () => {
    it('keeps only identity and app-origin entries and drops every credential', () => {
        const har = scrubHar(recorded(), { hosts: [IDENTITY, 'e2e.dotyou.cloud:4443'], secrets: [TOKEN] });

        expect(har.log.entries).toHaveLength(1);
        const [{ request, response }] = har.log.entries;
        expect(request.headers).toEqual([{ name: 'Accept', value: 'application/json' }]);
        expect(request.cookies).toEqual([]);
        expect(response.headers).toEqual([
            { name: 'access-control-expose-headers', value: 'SharedSecretEncryptedHeader64,SUB32' },
            { name: 'content-type', value: 'application/json' },
        ]);
        expect(findHarProblems(har, [TOKEN])).toEqual([]);
    });
});

describe('findHarProblems', () => {
    it('names each entry holding a credential header, cookies, a token-like value or the literal secret', () => {
        const problems = findHarProblems(recorded(), [TOKEN]);
        const reasons = problems.map((p: { index: number; reason: string }) => `${p.index}: ${p.reason}`);

        expect(reasons).toEqual(expect.arrayContaining([
            '0: header "BX0900"',
            '0: header "Authorization"',
            '0: header "Set-Cookie"',
            '0: non-empty cookies',
            '0: a value matching /Bearer\\s|BX0900/i',
            "0: the recording session's literal token/secret",
            '1: non-empty cookies',
        ]));
    });

    it('flags a cookie header added to an otherwise clean entry', () => {
        const har = { log: { entries: [entry(`https://${IDENTITY}/cdn/sitedata.json`)] } };
        har.log.entries[0].request.cookies = [];
        expect(findHarProblems(har)).toEqual([]);

        har.log.entries[0].request.headers.push({ name: 'cookie', value: 'a=1' });
        expect(findHarProblems(har)).toEqual([{ index: 0, reason: 'header "cookie"' }]);
    });
});
