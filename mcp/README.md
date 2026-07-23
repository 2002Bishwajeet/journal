# Journal MCP server

Exposes your Homebase journal notes to AI agents (Claude Desktop, Claude Code, etc.)
the way Notion's MCP exposes Notion pages. It reuses the app's own
`NotesDriveProvider` and Yjs helpers — it is a thin wrapper, not a reimplementation.

## Tools

| Tool | Status |
|------|--------|
| `list_notes` | ✅ works |
| `get_note` (body as markdown) | ✅ works |
| `search_notes` (title/tags) | ✅ works |
| `create_note` (title + tags) | ✅ works — body text is **rung 2** below |

## Setup

```bash
# from repo root — adds the extra deps to the app's node_modules
npm i -D @modelcontextprotocol/sdk vite-node dotenv

cp mcp/.env.example mcp/.env   # then fill in the 3 values
```

Get the three values from the **running app's** browser DevTools →
Application → Local Storage: `IDENTITY`, `APSS`, `BX0900`.

The `mcp` script is already in the root `package.json`:

```json
"mcp": "vite-node -r dotenv/config mcp/server.ts dotenv_config_path=mcp/.env"
```

Run it:

```bash
npm run mcp
```

Register it with Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "journal": { "command": "npm", "args": ["run", "mcp"], "cwd": "/Users/biswa/Documents/GitHub/journal" }
  }
}
```

## Why vite-node (not node/tsx)

`src/lib/homebase/config.ts` uses Vite's `import.meta.env`, and imports use the
`@/` alias. `vite-node` resolves both exactly as the app does. Plain `node`/`tsx`
would throw on `import.meta.env`.

## Rung 2 — writing note bodies

Note bodies are Yjs binary documents, not text. Reading decodes via
`extractMarkdownFromYjs`; writing needs the reverse (markdown/text → Yjs update).
The importer almost certainly already has this — start at
`src/lib/importexport/` (ImportService) and wire that encoder into `create_note`
/ a new `update_note` tool. Skipped until you need agents to write bodies.

## Auth ceiling

This reuses the app's existing browser token. It expires when your app session
does. For a long-lived, independently-revocable agent, register a dedicated
Homebase app (same flow the journal app uses, `JOURNAL_APP_ID` in `config.ts`)
and mint its own token instead. Skipped — overkill for personal use.
