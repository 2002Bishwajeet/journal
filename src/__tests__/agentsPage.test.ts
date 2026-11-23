// @vitest-environment happy-dom
/**
 * #1454: the agents page's install card. Every command has its own row and Copy button that copies that
 * one command, the "Your Homebase address" field writes the address into every command, Claude Desktop
 * is the first tab, the config snippets are only the journal entry, and the reference lists every tool.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '../../site/vite.config';
import { IDENTITY_PLACEHOLDER, identityFrom, startInstallCard } from '../../site/src/agents';

// A path, not new URL(`…${file}`, import.meta.url): Vite turns that into a glob of the whole repo under happy-dom.
const read = (file: string) => readFileSync(resolve(import.meta.dirname, '../..', file), 'utf8');
const html = render(read('site/agents.html'), { billing: false, downloads: false, stores: false, renew: false });
const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)![1];

const writeText = vi.fn<(text: string) => Promise<void>>();
const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
const $$ = <T extends Element>(selector: string) => [...document.querySelectorAll<T>(selector)];

async function copy(button: HTMLButtonElement): Promise<string> {
    button.click();
    await vi.waitFor(() => expect(button.querySelector('.copy-label')!.textContent).toBe('Copied'));
    return writeText.mock.lastCall![0];
}

function type(value: string) {
    const input = $<HTMLInputElement>('#identity-input');
    input.value = value;
    input.dispatchEvent(new Event('input'));
}

beforeEach(() => {
    document.body.innerHTML = body;
    writeText.mockReset().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

describe('identityFrom', () => {
    it.each([
        ['alex.dotyou.cloud', 'alex.dotyou.cloud'],
        ['  Alex.DotYou.Cloud  ', 'alex.dotyou.cloud'],
        ['https://alex.dotyou.cloud/', 'alex.dotyou.cloud'],
        ['https://alex.dotyou.cloud/owner/settings', 'alex.dotyou.cloud'],
        ['alex. dotyou.cloud', 'alex.dotyou.cloud'],
        ['   ', ''],
    ])('reads %j as %j', (input, expected) => {
        expect(identityFrom(input)).toBe(expected);
    });
});

describe('the install card', () => {
    it('opens on Claude Desktop', () => {
        const tabs = $$<HTMLButtonElement>('.install [role="tab"]');
        expect(tabs.map((t) => t.textContent)).toEqual(['Claude Desktop', 'Claude Code', 'Cursor', 'Codex CLI']);
        expect(tabs[0].getAttribute('aria-selected')).toBe('true');
        expect($<HTMLElement>('#panel-desktop').hidden).toBe(false);
        expect($('.install [role="tablist"]').getAttribute('aria-labelledby')).toBe('install-title');
        expect($('#install-title').textContent).toBe('Which Claude do you use?');
    });

    it('has one numbered row and one Copy button per command, in every tab', () => {
        for (const panel of $$('.install [role="tabpanel"]')) {
            const rows = [...panel.querySelectorAll(':scope > ol.cmds > li')];
            expect(rows.length).toBeGreaterThan(1);
            for (const row of rows) {
                expect(row.querySelectorAll('[data-copy]')).toHaveLength(1);
                expect(row.querySelectorAll('pre code')).toHaveLength(1);
            }
        }
        expect($$('#panel-claude-code [data-copy]')).toHaveLength(3);
    });

    it('copies exactly the one command of its row', async () => {
        startInstallCard(document);
        expect(await copy($('[data-copy="install-code-marketplace"]'))).toBe('/plugin marketplace add 2002Bishwajeet/journal');
        expect(await copy($('[data-copy="install-code-plugin"]'))).toBe('/plugin install journal@journal');
        expect(await copy($('[data-copy="install-code-login"]'))).toBe(`/journal:login ${IDENTITY_PLACEHOLDER}`);
        for (const button of $$<HTMLButtonElement>('.install [data-copy]')) {
            const text = await copy(button);
            expect(text).toBe($(`#${button.dataset.copy}`).textContent);
            // A command is one line; only a config entry spans several.
            if (!button.dataset.copy!.endsWith('-config')) expect(text).not.toContain('\n');
        }
        expect(writeText).toHaveBeenCalledTimes(3 + $$('.install [data-copy]').length);
    });

    it('keeps the field hidden until the script runs, so the placeholder stays without it', () => {
        expect($<HTMLElement>('.identity-field').hidden).toBe(true);
        startInstallCard(document);
        expect($<HTMLElement>('.identity-field').hidden).toBe(false);
        expect($('label[for="identity-input"]').textContent).toBe('Your Homebase address');
    });

    it('writes the address into every command and the revoke text as you type', async () => {
        startInstallCard(document);
        const identities = $$('.identity');
        // Every login command (four tabs), the terminal output (two) and the revoke text.
        expect(identities.length).toBe(7);
        expect($$('.identity-hint').every((hint) => !(hint as HTMLElement).hidden)).toBe(true);

        expect(identities.some((el) => el.hasAttribute('data-filled'))).toBe(false);

        type('https://alex.dotyou.cloud/');
        expect(identities.every((el) => el.textContent === 'alex.dotyou.cloud')).toBe(true);
        // Filled in: the address loses its dotted placeholder look.
        expect(identities.every((el) => el.hasAttribute('data-filled'))).toBe(true);
        expect($$('.identity-hint').every((hint) => (hint as HTMLElement).hidden)).toBe(true);
        expect(await copy($('[data-copy="install-desktop-login"]'))).toBe('npx -y journal-mcp@latest login alex.dotyou.cloud');
        expect(await copy($('[data-copy="install-code-login"]'))).toBe('/journal:login alex.dotyou.cloud');
        expect($('.fixes').textContent).toContain('login alex.dotyou.cloud');

        type('');
        expect(identities.every((el) => el.textContent === IDENTITY_PLACEHOLDER)).toBe(true);
        expect(identities.some((el) => el.hasAttribute('data-filled'))).toBe(false);
        expect($$('.identity-hint').every((hint) => !(hint as HTMLElement).hidden)).toBe(true);
    });

    it('tells a screen reader what was copied', async () => {
        startInstallCard(document);
        await copy($('[data-copy="install-code-plugin"]'));
        expect($('#copy-status').getAttribute('role')).toBe('status');
        expect($('#copy-status').textContent).toBe('Copied the command that installs the plugin');
    });

    it('selects the command when the clipboard is blocked, so it can still be copied by hand', async () => {
        startInstallCard(document);
        writeText.mockRejectedValue(new Error('blocked'));
        const button = $<HTMLButtonElement>('[data-copy="install-desktop-login"]');
        button.click();
        await vi.waitFor(() => expect(button.querySelector('.copy-label')!.textContent).toBe('Selected, now copy'));
        expect(getSelection()!.toString()).toBe(`npx -y journal-mcp@latest login ${IDENTITY_PLACEHOLDER}`);
        expect($('#copy-status').textContent).toContain('is selected');
    });

    it('reads instruction, command, then its Copy button, and says what the address field does', () => {
        for (const row of $$('.install .snippet')) {
            const order = [...row.children].map((el) => el.tagName);
            expect(order.indexOf('PRE')).toBeLessThan(order.indexOf('BUTTON'));
        }
        expect($('#identity-input').getAttribute('aria-describedby')).toBe('identity-help');
        expect($('#identity-help').textContent).toBe('Type it once and every command below fills it in. Nothing is saved.');
    });

    it('shows each login with the hint under it', () => {
        for (const id of ['install-desktop-login', 'install-code-login', 'install-cursor-login', 'install-codex-login']) {
            const row = $(`#${id}`).closest('li')!;
            expect(row.querySelector('.identity-hint')!.textContent).toBe('Replace with your Homebase address, e.g. alex.dotyou.cloud');
        }
    });

    it('gives Claude Desktop and Cursor only the journal entry, to paste inside mcpServers', () => {
        for (const id of ['install-desktop-config', 'install-cursor-config']) {
            const text = $(`#${id}`).textContent!;
            expect(text.startsWith('"journal": {')).toBe(true);
            expect(text).not.toContain('mcpServers');
            expect($(`#${id}`).closest('li')!.querySelector('.code-note')!.textContent).toContain('inside "mcpServers"');
        }
    });
});

describe('the page copy', () => {
    it('never shows the old sample identity', () => {
        expect(html).not.toContain('you.dotyou.cloud');
    });

    it('says plainly where it runs, which Claude apps work, and what Claude can and cannot do', () => {
        const text = document.body.textContent!.replace(/\s+/g, ' ');
        expect(text).toContain("It runs on your computer and talks to your notes directly. Your notes don't pass through any Journal server.");
        expect(text).not.toContain('Set up the server');
        const rows = $$('.apps tbody tr').map((tr) => [...tr.children].map((c) => c.textContent));
        expect(rows).toEqual([
            ['Claude Desktop (Mac, Windows)', 'Yes'],
            ['Claude Code', 'Yes'],
            ['claude.ai on the web', 'Not yet'],
            ['Claude on iPhone and Android', 'Not yet'],
        ]);
        const can = $('.can').textContent!.replace(/\s+/g, ' ');
        expect(can).toContain('only in the folders you grant');
        expect(can).toContain('See folders set to None, or notes marked ‘exclude from AI’');
        expect(can).toContain('Delete a note for good');
    });

    it('names the page Use with Claude in the header and the footer', () => {
        expect($$('a[href="/landing/agents"]').map((a) => a.textContent)).toEqual(['Use with Claude', 'Use with Claude', 'Use with Claude']);
    });

    it('documents every tool the MCP server registers, and gives no count', () => {
        const registry = [...read('src/lib/agent/tools/registry.ts').matchAll(/defineTool\(\{\s*name: '(\w+)'/g)].map((m) => m[1]);
        const serverOnly = [...read('mcp/createServer.ts').matchAll(/registerTool\(\s*'(\w+)'/g)].map((m) => m[1]);
        const tools = [...registry, ...serverOnly];
        expect(tools).toEqual(expect.arrayContaining(['run_script', 'share_note', 'get_sharing', 'publish_to_feed']));
        const documented = $$('article.tool').map((a) => a.id.replace('tool-', ''));
        expect(documented.sort()).toEqual([...tools].sort());
        expect($$('.tool-index a').map((a) => a.getAttribute('href')!.replace('#tool-', '')).sort()).toEqual([...tools].sort());
        expect(html).not.toMatch(/fourteen/i);
    });
});
