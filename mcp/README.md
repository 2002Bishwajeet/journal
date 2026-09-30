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
- `create_folder` — create a folder (`name`). The agent gets Read+write on the new folder
  so it can add notes to it; revoke that in Settings → Agent access like any other grant.
  Example: *"Make a Research folder and save these notes in it."*
- `append_to_note` — append markdown to the end of a note (`id`, `markdown`).
  Example: *"Append today's standup summary to my Work log."*
- `replace_in_note` — replace one unique span of the note's markdown, as `get_note`
  returns it (`id`, `old_text`, `new_text`). If `old_text` matches zero or several
  times the tool returns an error, so the agent can retry with more context.
  Example: *"In my Trip plan note, change the flight time from 9:40 to 10:15."*

## What the markdown can contain

The write tools take markdown. Besides ordinary markdown (headings, lists, task lists,
tables, links, code), these render as richer blocks in Journal:

- **Callout** — a blockquote whose first line is `> [!info]`, `> [!tip]`, `> [!warning]`
  or `> [!error]`.
- **Toggle** — `<details>` with a `<summary>` line, then a blank line, the body, a blank
  line and `</details>`.
- **Live blocks** — a fenced code block whose language is `mermaid`, `svg` or `html`.
  Journal shows a preview with a Code / Preview toggle, in the editor and on the note's
  public share page.

Not available through these tools: uploading images or a cover image, link-preview cards
(a link on its own line stays a plain link) and note-to-note links.

### Live blocks

| Language | Renders as | Runs script |
|---|---|---|
| `mermaid` | a diagram, coloured to match the light or dark theme | no |
| `svg` | an image; scripts and external references inside the SVG are ignored | no |
| `html` | a running page in a sandboxed frame | yes, isolated |

Example: *"Add a mermaid flowchart of the release process and a small HTML tip calculator
to my Notes folder."*

### How an `html` block works

The block's source is loaded into an `<iframe sandbox="allow-scripts">` with a strict
Content-Security-Policy. The frame has its own throwaway origin, so the page cannot see
the note, the app, or anything stored by Journal.

An `html` block **can** contain:

- A full document or just a fragment. A lone `<div>…</div>` is fine; `<html>` and
  `<body>` are optional.
- Inline `<style>` and inline `<script>`, including event handlers, timers, `<canvas>`,
  inline `<svg>`, CSS animations and form controls handled by script.
- Images, fonts and media as `data:` URIs.

It **cannot**:

- Make network requests: `fetch`, `XMLHttpRequest` and `WebSocket` all fail.
- Load anything external: no `<script src>`, no stylesheet links, no web fonts, no
  `https://` images. That rules out CDN libraries such as React, Tailwind or Chart.js.
- Use storage. `localStorage`, `sessionStorage`, `indexedDB` and `document.cookie` throw
  a `SecurityError`, so wrap any such call in `try`/`catch`. State is lost on reload.
- Open popups, submit forms to a URL, navigate the app, or start downloads.

The frame is 400px tall by default and the reader can drag it taller. It is as wide as the
note column, so design for roughly 650px and let the layout stretch.

Planned, not available yet: automatic height and fullscreen, scripts from an allowlisted
CDN, and saved state stored in the note.

### Designing an `html` block

A live block has no card or header around it: it sits on the note like a table or an
image. The page in the frame starts with the note's look, in the light and the dark
theme: a transparent background, the note's text colour, font and line height, no body
margin, and table cells with the note's border. These variables hold the theme's current
values:

| Variable | Use it for |
|---|---|
| `--foreground` | text, and lines that should be as strong as text |
| `--muted-foreground` | secondary text: captions, labels, axis ticks |
| `--muted` | the fill of a box, a table header or a bar |
| `--accent` | a hover or selected fill |
| `--border` | borders and rules |
| `--radius` | corner radius |
| `--background` | the note's own background, for something drawn on top of a fill |
| `--secondary`, `--primary` | a button's fill: quiet, or the one strong action |

Rules:

- **Do not set a page background or a font.** The block inherits both, so it matches the
  note in either theme; a white page is a bright box in the dark theme.
- **Draw with the variables, not with colours of your own.** A fixed colour is right in
  one theme at most, and the variables follow the reader's theme.
- **No gradients, shadows or rows of badges.** The note is flat and quiet, and decoration
  is what makes a block read as a widget dropped into it.
- **Prefer a callout or a table when one would do.** They are the note's own blocks: the
  reader can edit them in place and they stay readable as markdown. Keep `html` for what
  needs script or a layout markdown cannot make.

Example:

````markdown
```html
<div style="background: var(--muted); border: 1px solid var(--border); border-radius: var(--radius); padding: 12px 16px">
  <strong>3 of 5 tasks done</strong>
  <div style="color: var(--muted-foreground)">Two are waiting on review.</div>
</div>
```
````

In the app itself, pasting bare markup or a fenced block into an empty line of a note
creates the same live block.

## Why vite-node

`src/lib/homebase/config.ts` and friends use Vite's `import.meta.env` and the `@/` import
alias. `vite-node` resolves both exactly as the app does — plain `node`/`tsx` would throw
on `import.meta.env`.
