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
OS keychain. On headless Linux, where no keychain is available, it falls back to a `0600` file at `$XDG_CONFIG_HOME/journal-mcp/credentials.json` (default `~/.config/journal-mcp/credentials.json`).

```bash
npm run mcp:login -- you.dotyou.cloud
```

This prints an authorization URL and tries to open it in your browser. Approve the
Journal MCP app in the owner console; the login command then saves your credentials and
exits.

### Headless / SSH login

On a machine with no browser (over SSH, a container), add `--no-browser`:

```bash
npm run mcp:login -- --no-browser you.dotyou.cloud
```

It prints the approval URL and starts no local server. Open the URL in any browser,
approve **Journal MCP**, and the Journal app shows a login code. Paste it at the
`Paste code:` prompt and the credentials are saved. The code holds only public values;
the private key never leaves the terminal. Set `JOURNAL_MCP_APP_ORIGIN` to use a
different Journal app origin than `https://journal.cloudx.run` (dev or testing).

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
- `get_note` — one granted note by id, body as markdown. With `format: "blocks"`, the
  body is a list of top-level blocks (`id`, `type`, `markdown`, `attrs`, and `rows` for a
  table), whose ids `edit_block` takes.
- `search_notes` — case-insensitive substring search over title, tags and body of
  granted notes.
- `get_authoring_guide` — the authoring reference, [`AUTHORING.md`](AUTHORING.md): everything a
  note can hold and how to write it.

Write tools need **Read+write** access; a note marked "exclude from AI" is never
readable or writable. Every edit is applied to the note's current state and merged, not
overwritten, so anything you type in Journal at the same time is kept. Edited notes are
attributed to `agent:<client name>` (e.g. `agent:claude-code`).

- `create_note` — create a note from markdown in a writable folder (`title`, `markdown`,
  `folderId`, optional `tags`).
  Example: *"Create a note called Standup 2026-09-28 in my Work folder with today's
  summary."*
- `create_folder` — create a folder (`name`). The agent gets Read+write on the new folder
  so it can add notes to it; revoke that in Settings → Agent access like any other grant.
  Example: *"Make a Research folder and save these notes in it."*
- `append_to_note` — append markdown to the end of a note (`id`, `markdown`).
  Example: *"Append today's standup summary to my Work log."*
- `replace_in_note` — replace one unique span of the note's markdown, as `get_note`
  returns it (`id`, `old_text`, `new_text`). If `old_text` matches zero or several
  times the tool returns an error, so the agent can retry with more context.
  Example: *"In my Trip plan note, change the flight time from 9:40 to 10:15."*
- `update_note` — rewrite a note's whole body (`markdown`), `title` and/or `tags` (`id`,
  each optional). Blocks kept exactly as `get_note` returned them stay untouched. Pass
  `get_note`'s `modified` as `expectedModified` to have the edit refused if the note
  changed since.
  Example: *"Redesign my Trip plan note as a day-by-day itinerary."*
- `edit_block` — edit one block by its id from `get_note` with `format: "blocks"`
  (`note_id`, `block_id`, `op`, optional `expectedModified`). Ops: `replace`,
  `insert_before`, `insert_after`, `delete`, `set_text` (a callout's or toggle's body,
  keeping its variant or summary), `set_attrs`, and for tables `set_cell`, `insert_row`,
  `delete_row`, `insert_column`, `delete_column`, which keep column widths and the other
  cells. Every other block is left untouched. See
  [Editing one block](AUTHORING.md#editing-one-block).
  Example: *"In my Trip plan table, set Tuesday's plan to Hike."*
- `delete_note` — move a note to Journal's Trash (`id`), where you can restore it. It is
  never deleted permanently.
  Example: *"Delete the duplicate Trip plan note."*
- `set_note_cover` — set a note's cover image (`id`, `image`, optional `positionY` 0–100,
  default 50, and `dark`). `image` is a path to a file on this computer or a base64
  `data:` URI; PNG, JPEG or WebP up to 5 MB. EXIF/GPS, XMP and text metadata are removed
  before upload, without re-encoding (so a JPEG's EXIF rotation is dropped too). `dark: true`
  sets the dark-mode cover, next to an existing cover. On a public note the link-preview
  card image is redrawn the next time the note is saved in Journal; until then link
  previews show the plain cover.
  Example: *"Use ~/Pictures/lisbon.jpg as the cover of my Trip plan note."*
- `clear_note_cover` — remove a note's cover and its dark-mode cover (`id`), or with
  `dark: true` only the dark-mode cover.

## What the markdown can contain

The write tools take markdown, and a note can hold much more than text: callouts, toggles,
task lists, tables, math, footnotes, images, a cover, and live `mermaid`, `svg`, `html` and
`react` blocks for diagrams, charts, dashboards and small interactive tools.
[`AUTHORING.md`](AUTHORING.md) is the full reference: the syntax of every block, what a
live block can load and do, the design rules and complete examples. The server returns the
same file from `get_authoring_guide`, and its `initialize` instructions give agents a short
summary pointing there.

In the app itself, pasting bare markup or a fenced block into an empty line of a note
creates the same live block.

## Why vite-node

`src/lib/homebase/config.ts` and friends use Vite's `import.meta.env` and the `@/` import
alias. `vite-node` resolves both exactly as the app does — plain `node`/`tsx` would throw
on `import.meta.env`.
