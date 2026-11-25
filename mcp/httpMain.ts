import { createMcpHttpServer, MCP_PATH } from './http';
import { loadCredentials } from './credentials';
import { createDriveDeps } from './drive';

// Hosted MCP spike (#1504): `npm run mcp:http` serves the tools at http://127.0.0.1:8790/journal/mcp
// with the `journal-mcp login` credentials. Loopback only: there is no auth in front of it yet.
const creds = loadCredentials();
if (!creds) {
    console.error('Not logged in. Run: npm run mcp:login -- <identity>');
    process.exit(1);
}
const port = Number(process.env.PORT ?? 8790);
createMcpHttpServer(() => createDriveDeps(creds)).listen(port, '127.0.0.1', () => {
    console.error(`Journal MCP on http://127.0.0.1:${port}${MCP_PATH} as ${creds.identity}`);
});
