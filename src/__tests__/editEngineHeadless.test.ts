/**
 * #316: the agent edit engine (`src/lib/agent/editEngine.ts`) is imported by the
 * MCP server over stdio. Its schema used to come from `createSchemaExtensions()`,
 * which pulled in React node views (`ImageNode.tsx`, `NoteLinkNodeView.tsx`) and,
 * through them, `@/lib/db` — whose PGlite/BroadcastChannel side effects log to
 * stdout (corrupting the JSON-RPC stream) and keep the process alive.
 *
 * Checked via vite-node's own module graph — the same resolver `npm run mcp`
 * uses — so this proves what actually gets imported, not what the source merely
 * intends.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { createServer, type ViteDevServer } from 'vite';
import { ViteNodeServer } from 'vite-node/server';
import { ViteNodeRunner } from 'vite-node/client';
import path from 'node:path';

describe('editEngine is Node-safe to import', () => {
  let server: ViteDevServer | undefined;

  afterAll(async () => {
    await server?.close();
  });

  it('loads no .tsx file and no @/lib/db module', async () => {
    server = await createServer({
      logLevel: 'error',
      server: { hmr: false, watch: null },
    });
    await server.pluginContainer.buildStart({});

    const node = new ViteNodeServer(server);
    const runner = new ViteNodeRunner({
      root: server.config.root,
      base: server.config.base,
      fetchModule: (id) => node.fetchModule(id),
      resolveId: (id, importer) => node.resolveId(id, importer),
    });

    await runner.executeFile(path.resolve('src/lib/agent/editEngine.ts'));

    const loaded = [...runner.moduleCache.keys()];
    const tsxFiles = loaded.filter((f) => f.endsWith('.tsx'));
    const dbFiles = loaded.filter((f) => f.includes('/src/lib/db/'));

    expect(tsxFiles).toEqual([]);
    expect(dbFiles).toEqual([]);
  });
});
