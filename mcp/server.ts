import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createJournalMcpServer } from './createServer';
import { loadCredentials, deleteCredentials } from './credentials';

const USAGE = `Usage: journal-mcp [login [identity] | logout | --help]

  (no command)  Start the MCP server over stdio.
  login [id]    Register the Journal MCP app on your identity and save credentials.
  logout        Delete saved credentials from the OS keychain.
  --help        Show this message.
`;

async function main(): Promise<void> {
    const [, , command, ...rest] = process.argv;

    if (command === '--help' || command === '-h') {
        console.error(USAGE);
        process.exit(0);
    }

    if (command === 'login') {
        const { login } = await import('./login');
        await login(rest[0]);
        return;
    }

    if (command === 'logout') {
        deleteCredentials();
        console.error('Logged out. Credentials removed from the OS keychain.');
        return;
    }

    if (command) {
        console.error(`Unknown command: ${command}\n\n${USAGE}`);
        process.exit(1);
    }

    const creds = loadCredentials();
    if (!creds) {
        console.error('Not logged in. Run: npm run mcp:login');
        process.exit(1);
    }

    // Deferred: pulls in the Homebase drive providers and Yjs markdown extraction, which
    // --help/login/logout have no need for.
    const { createDriveDeps } = await import('./drive');
    const server = createJournalMcpServer(createDriveDeps(creds));
    await server.connect(new StdioServerTransport());
    // Correct stdio behaviour for an MCP server: exit when the client closes our stdin
    // instead of lingering as an orphaned process.
    process.stdin.on('end', () => process.exit(0));
}

main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
});
