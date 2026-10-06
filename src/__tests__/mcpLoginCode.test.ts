import { describe, it, expect } from 'vitest';
import { encodeMcpLoginCode, decodeMcpLoginCode } from '@/lib/mcpLoginCode';

describe('mcpLoginCode', () => {
    it('round-trips', () => {
        const v = { identity: 'a.example', public_key: 'PK+/=', salt: 'sált' };
        const code = encodeMcpLoginCode(v);
        expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(decodeMcpLoginCode(code)).toEqual(v);
    });

    it('rejects garbage', () => {
        expect(() => decodeMcpLoginCode('!!!not base64')).toThrow(/Invalid login code/);
        expect(() => decodeMcpLoginCode('')).toThrow(/Invalid login code/);
    });

    it('rejects non-object payloads', () => {
        expect(() => decodeMcpLoginCode(btoa('[1]'))).toThrow(/missing identity/);
        expect(() => decodeMcpLoginCode(btoa('null'))).toThrow(/expected an object/);
    });

    it('rejects missing fields', () => {
        const code = btoa(JSON.stringify({ identity: 'a', salt: 's' })).replace(/=+$/, '');
        expect(() => decodeMcpLoginCode(code)).toThrow(/missing public_key/);
    });
});
