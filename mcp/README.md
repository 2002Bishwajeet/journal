# Journal MCP server

Lets a local MCP client (Claude Code, Codex CLI, Claude Desktop) read, search, create
and edit the notes you've granted it, using its own Homebase app registration — separate from the
Journal web app's session, so it can be revoked independently.

Notes and folders are hidden from every tool until you grant them access in
**Journal → Settings → Agent access**. Access defaults to **none**.

## Claude Code plugin (one-click)

```
/plugin marketplace add 2002Bishwajeet/journal
/plugin install journal@journal
/journal:login you.dotyou.cloud
```

Then run `/mcp` to reconnect `journal`, and grant folders in **Journal → Settings → Agent access**.
The plugin runs the packaged server from the `mcp-v*` GitHub release via `npx`; no checkout needed.

To release a new server version: bump `mcp/package/package.json` and the URLs in
`plugins/journal/`, merge, then run the **Release MCP package** workflow.

## Setup (from a checkout)

Log in once per identity. This registers a "Journal MCP" app on your identity (its own
appId, Read+Write on the notes drive only) and saves the resulting credentials to your
OS keychain — nothing is written to disk.

```bash
npm run mcp:login -- you.dotyou.cloud
```

This prints an authorization URL and tries to open it in your browser. Approve the
Journal MCP app in the owner console; the login command then saves your credentials and
exits.

To remove the saved credentials from this machine:

```bash
npm run mcp:logout
```

To fully revoke access (e.g. from another device, or if this machine is compromised),
remove the app from the owner console: **Apps → Journal MCP**.

## Registering with an MCP client

Claude Code:

```bash
claude mcp add journal -- npm --prefix /absolute/path/to/journal run --silent mcp
```

Codex CLI (`~/.codex/config.toml`):

```toml
[mcp_servers.journal]
command = "npm"
args = ["--prefix", "/absolute/path/to/journal", "run", "--silent", "mcp"]
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "journal": {
      "command": "npm",
      "args": ["--prefix", "/absolute/path/to/journal", "run", "--silent", "mcp"]
    }
  }
}
```

## Tools

- `list_folders` — folders you've granted access to.
- `list_notes` — granted notes, newest first (optional `folderId`, `limit`).
- `get_note` — one granted note by id, body as markdown.
- `search_notes` — case-insensitive substring search over title, tags and body of
  granted notes.

Write tools need **Read+write** access; a note marked "exclude from AI" is never
readable or writable. Every edit is applied to the note's current state and merged, not
overwritten, so anything you type in Journal at the same time is kept. Edited notes are
attributed to `agent:<client name>` (e.g. `agent:claude-code`).

- `create_note` — create a note from markdown in a writable folder (`title`, `markdown`,
  `folderId`, optional `tags`).
  Example: *"Create a note called Standup 2026-09-28 in my Work folder with today's
  summary."*
- `append_to_note` — append markdown to the end of a note (`id`, `markdown`).
  Example: *"Append today's standup summary to my Work log."*
- `replace_in_note` — replace one unique span of the note's markdown, as `get_note`
  returns it (`id`, `old_text`, `new_text`). If `old_text` matches zero or several
  times the tool returns an error, so the agent can retry with more context.
  Example: *"In my Trip plan note, change the flight time from 9:40 to 10:15."*

## Why vite-node

`src/lib/homebase/config.ts` and friends use Vite's `import.meta.env` and the `@/` import
alias. `vite-node` resolves both exactly as the app does — plain `node`/`tsx` would throw
on `import.meta.env`.
