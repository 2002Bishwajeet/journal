import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createJournalMcpServer } from './createServer';

// The npm package's README (#1035): mcp/README.npm.md with the tool list read from the real server, so it can't drift.
// `npm run mcp:pack` runs this with --write, which also copies the repo's LICENSE into the package.

/** The server's tools as a markdown table: name, whether it writes, and the first sentence of its description. */
async function toolTable(): Promise<string> {
    const server = createJournalMcpServer({} as Parameters<typeof createJournalMcpServer>[0]);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'npm-readme', version: '0' });
    await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
    const { tools } = await client.listTools();
    await client.close();
    const rows = tools.map((t) => `| \`${t.name}\` | ${t.annotations?.readOnlyHint ? 'Reads' : 'Writes'} | ${(t.description ?? '').split(/(?<=\.)\s/)[0]} |`);
    return ['| Tool | Access | What it does |', '| --- | --- | --- |', ...rows].join('\n');
}

export async function npmReadme(): Promise<string> {
    const template = readFileSync(path.resolve(import.meta.dirname, 'README.npm.md'), 'utf8');
    return template.replace(/^<!--.*?-->\n\n/, '').replace('<!-- tools -->', await toolTable());
}

if (process.argv.includes('--write')) {
    writeFileSync(path.resolve(import.meta.dirname, 'package/README.md'), await npmReadme());
    copyFileSync(path.resolve(import.meta.dirname, '../LICENSE'), path.resolve(import.meta.dirname, 'package/LICENSE'));
}
