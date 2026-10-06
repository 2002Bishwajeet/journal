import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const keyring = vi.hoisted(() => ({ broken: false, stored: null as string | null }));

vi.mock('@napi-rs/keyring', () => ({
    Entry: class {
        setPassword(v: string) {
            if (keyring.broken) throw new Error('no secret service');
            keyring.stored = v;
        }
        getPassword() {
            if (keyring.broken) throw new Error('no secret service');
            return keyring.stored;
        }
        deletePassword() {
            if (keyring.broken) throw new Error('no secret service');
            keyring.stored = null;
        }
    },
}));

import { deleteCredentials, loadCredentials, saveCredentials } from '../../mcp/credentials';

const creds = { identity: 'me.dotyou.cloud', clientAuthToken: 'tok', sharedSecret: 'sec' };

describe('mcp credentials', () => {
    let dir: string;
    const prev = process.env.XDG_CONFIG_HOME;

    beforeEach(() => {
        dir = mkdtempSync(join(tmpdir(), 'mcp-cred-'));
        process.env.XDG_CONFIG_HOME = dir;
        keyring.broken = false;
        keyring.stored = null;
    });

    afterEach(() => {
        if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
        else process.env.XDG_CONFIG_HOME = prev;
        rmSync(dir, { recursive: true, force: true });
    });

    const file = () => join(dir, 'journal-mcp', 'credentials.json');

    it('uses the keyring and creates no file when it works', () => {
        saveCredentials(creds);
        expect(existsSync(file())).toBe(false);
        expect(loadCredentials()).toEqual(creds);
        deleteCredentials();
        expect(loadCredentials()).toBeNull();
    });

    it('falls back to a 0600 file when the keyring throws', () => {
        keyring.broken = true;
        expect(saveCredentials(creds)).toBe(file());
        expect(statSync(file()).mode & 0o777).toBe(0o600);
        expect(statSync(join(dir, 'journal-mcp')).mode & 0o777).toBe(0o700);
        expect(loadCredentials()).toEqual(creds);
        deleteCredentials();
        expect(existsSync(file())).toBe(false);
        expect(() => deleteCredentials()).not.toThrow();
    });
});
