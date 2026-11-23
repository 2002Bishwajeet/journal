import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { firstSentence, serverTools } from './npmReadme';

// The Claude Desktop extension (#1457): a .mcpb bundle (https://github.com/anthropics/mcpb, MANIFEST.md) of the built
// server, so connecting Claude Desktop needs no terminal and no Node install. `npm run mcp:mcpb` builds the server,
// stages it with its manifest, icon and keychain module, then validates and packs it into mcp/journal-mcp-<version>.mcpb.
// The extension starts the server with the Homebase address typed at install; its first run signs in (mcp/firstRun.ts).

const MCPB_CLI = '@anthropic-ai/mcpb@2.1.2';
// Claude Desktop runs on macOS and Windows: @napi-rs/keyring's native build for each, since npm installs only this machine's.
const KEYRING_BUILDS = ['darwin-arm64', 'darwin-x64', 'win32-x64-msvc', 'win32-arm64-msvc'];
const ENTRY = 'server/index.mjs';

const dir = import.meta.dirname;
const stage = path.join(dir, 'mcpb-build');

type Tool = { name: string; description?: string };

export function mcpbManifest(version: string, tools: Tool[]) {
    return {
        manifest_version: '0.3',
        name: 'journal',
        display_name: 'Journal',
        version,
        description: 'Let Claude read, search and edit the Journal notes you grant it, on your Homebase identity.',
        long_description:
            'Journal MCP runs on your computer and talks to your Homebase identity directly: your notes pass through no Journal server. ' +
            'The first time it starts, your browser opens to approve Journal MCP on your identity. ' +
            'Claude sees only the folders you grant in Journal → Settings → Agent access.',
        author: { name: 'Bishwajeet Parhi', url: 'https://github.com/2002Bishwajeet' },
        repository: { type: 'git', url: 'https://github.com/2002Bishwajeet/journal' },
        homepage: 'https://journal.cloudx.run/landing/agents',
        documentation: 'https://github.com/2002Bishwajeet/journal/tree/main/mcp#readme',
        support: 'https://github.com/2002Bishwajeet/journal/issues',
        icon: 'icon.png',
        server: {
            type: 'node',
            entry_point: ENTRY,
            mcp_config: {
                command: 'node',
                args: [`\${__dirname}/${ENTRY}`],
                env: { JOURNAL_MCP_IDENTITY: '${user_config.identity}' },
            },
        },
        tools: tools.map((t) => ({ name: t.name, description: firstSentence(t.description) })),
        user_config: {
            identity: {
                type: 'string',
                title: 'Homebase address',
                description: 'Your Homebase identity, such as alex.dotyou.cloud. The first time Journal starts, your browser opens to approve it.',
                required: true,
            },
        },
        keywords: ['notes', 'journal', 'homebase'],
        license: 'AGPL-3.0-only',
        compatibility: { platforms: ['darwin', 'win32'], runtimes: { node: '>=20.0.0' } },
    };
}

async function pack(): Promise<void> {
    const pkg = JSON.parse(readFileSync(path.join(dir, 'package/package.json'), 'utf8'));
    const keyring: string = pkg.dependencies['@napi-rs/keyring'];

    rmSync(stage, { recursive: true, force: true });
    mkdirSync(path.join(stage, 'server'), { recursive: true });
    copyFileSync(path.join(dir, 'package/dist/server.mjs'), path.join(stage, ENTRY));
    copyFileSync(path.join(dir, '../brand/png/app-icon-512.png'), path.join(stage, 'icon.png'));
    writeFileSync(path.join(stage, 'manifest.json'), JSON.stringify(mcpbManifest(pkg.version, await serverTools()), null, 2));

    const dependencies = Object.fromEntries([['@napi-rs/keyring', keyring], ...KEYRING_BUILDS.map((b) => [`@napi-rs/keyring-${b}`, keyring])]);
    writeFileSync(path.join(stage, 'package.json'), JSON.stringify({ name: 'journal-mcp-extension', private: true, type: 'module', dependencies }, null, 2));
    // --force installs the other platforms' builds; --omit=optional skips this machine's, which the extension never runs on.
    const npm = ['install', '--force', '--omit=optional', '--no-package-lock', '--no-audit', '--no-fund', '--ignore-scripts'];
    execFileSync('npm', npm, { cwd: stage, stdio: 'inherit' });

    const out = path.join(dir, `journal-mcp-${pkg.version}.mcpb`);
    execFileSync('npx', ['-y', MCPB_CLI, 'validate', path.join(stage, 'manifest.json')], { stdio: 'inherit' });
    execFileSync('npx', ['-y', MCPB_CLI, 'pack', stage, out], { stdio: 'inherit' });
}

if (process.argv.includes('--pack')) await pack();
