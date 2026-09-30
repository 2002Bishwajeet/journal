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
- **Live blocks** — a fenced code block whose language is `mermaid`, `svg`, `html` or `react`.
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
| `react` | a React component, run on Journal's own React in the same frame as `html` | yes, isolated |

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

The frame is as tall as its content, up to 1600px (taller content scrolls inside it), and
the reader can drag it to another height. It is as wide as the note column, so design for
roughly 650px and let the layout stretch.

Planned, not available yet: scripts from an allowlisted CDN, and saved state stored in the
note.

### How a `react` block works

A `react` block is JSX that defines a component named `App`, or exports one as default.
Journal compiles it and renders `App` on its own copy of React, the version the app itself
runs, in the same sandboxed frame as an `html` block: everything above about the frame
applies, and no CDN script is needed. `jsx` and `tsx` blocks stay ordinary code.

- Hooks are on `React` (`React.useState`, `React.useCallback`, …), and `useState`,
  `useEffect`, `useRef`, `useMemo` and `useReducer` also work without the prefix.
- It can import only from `react`. TypeScript is not supported.
- State lives in the component and is lost on reload.
- A syntax error is shown with its line in place of the component; an error while
  rendering is shown inside the frame.

````markdown
```react
function App() {
  const [count, setCount] = useState(0);
  return (
    <div>
      <p>Count: {count}</p>
      <button onClick={() => setCount(count + 1)}>Add one</button>
    </div>
  );
}
```
````

The design rules for `html` blocks below apply to a `react` block unchanged.

### Designing an `html` block

Journal's theme and design system come first. A block brings styling of its own only
where its content needs it, never as a default. In order:

1. **Prefer a native block whenever one can carry the content**: a callout, a table, a
   toggle, a task list or a mermaid diagram. They are the note's own blocks: the reader
   can edit them in place and they stay readable as markdown. Keep `html` for what needs
   script or a layout markdown cannot make.
2. **An `html` block uses the note's font, colours and the theme variables, and leaves
   buttons, inputs and tables unstyled.** The page inherits the note's font, text colour,
   line height and transparent background, and an unstyled `<button>`, `<input>`,
   `<select>`, `<textarea>`, checkbox, radio, range, `<progress>` or `<table>` is drawn
   like Journal's own, in the light and the dark theme. Styling them again is how a block
   stops matching.
3. **Custom styling only where the content needs it**: a chart, a diagram, a game board.
   Build it from the theme variables below. A fixed colour is right in one theme at most;
   the variables follow the reader's theme.
4. **No page background, gradients, shadows, badge rows, emoji headers or custom fonts.**
   The note is flat and quiet, and decoration is what makes a block read as a widget
   dropped into it. A white page is a bright box in the dark theme.
5. **The block sizes itself to its content.** Do not set a fixed page height (`100vh`, a
   tall `min-height`) or lay the block out as if it had a whole screen: it is one part of
   a note, as wide as the text column.

A live block has no card or header around it: it sits on the note like a table or an
image. These variables hold the theme's current values:

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
| `--ring` | a focus ring |
| `--chart-1` … `--chart-5` | data series in a chart, in this order; a mermaid pie uses the same five |

Good: no styling for the controls, and the one thing drawn (a bar) is built from the
variables.

````markdown
```html
<label>Bill <input id="bill" type="number" value="40"></label>
<label>Tip <input id="tip" type="range" min="0" max="30" value="15"></label>
<button onclick="out.textContent = (bill.value * (1 + tip.value / 100)).toFixed(2)">Work it out</button>
<p>Total: <strong id="out">46.00</strong></p>
<div style="height: 8px; background: var(--muted); border-radius: var(--radius)">
  <div style="width: 60%; height: 100%; background: var(--chart-1); border-radius: var(--radius)"></div>
</div>
```
````

Bad: a page of its own. It has a background, a font, a gradient, a shadow, an emoji
header, a restyled button and a fixed height, and it is wrong in the dark theme.

````markdown
```html
<style>
  body { background: #fff; font-family: Poppins, sans-serif; min-height: 100vh; }
  .card { background: linear-gradient(135deg, #667eea, #764ba2); box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3); }
  button { background: #4f46e5; color: #fff; border: none; border-radius: 999px; }
</style>
<div class="card"><h2>💸 Tip calculator</h2><button>Calculate</button></div>
```
````

In the app itself, pasting bare markup or a fenced block into an empty line of a note
creates the same live block.

## Why vite-node

`src/lib/homebase/config.ts` and friends use Vite's `import.meta.env` and the `@/` import
alias. `vite-node` resolves both exactly as the app does — plain `node`/`tsx` would throw
on `import.meta.env`.
