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
The plugin runs `npx -y journal-mcp@latest`, so restarting the client picks up each new release; no checkout needed.

To release a new server version, run the **Release MCP package** workflow and pick patch,
minor or major. It bumps `mcp/package/package.json`,
builds and smoke-tests the package, publishes it to npm as
[`journal-mcp`](https://www.npmjs.com/package/journal-mcp) (trusted publishing from the
workflow, with provenance; there is no npm token), then pushes the bump and tag
`mcp-v<version>` and creates the release with the `.tgz` attached.

### Updates

How clients get new versions, and the server's once-a-day stale-version notice (opt out with
`JOURNAL_MCP_NO_UPDATE_CHECK=1`), are described in the npm package's README,
[`README.npm.md`](README.npm.md#updates). `npm run mcp:pack` turns that file into
`mcp/package/README.md`, filling in the tool list from the server, and copies the repo's
`LICENSE` next to it.

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
- `list_notes` — granted notes, newest first (optional `folderId`, `limit`, and `fields`
  from `id`, `title`, `folderId`, `modified`, `tags`; the first four by default). A
  read-only note also has `access: "read"`.
- `get_note` — one granted note by id, body as markdown. With `format: "outline"`, the
  body is a list of top-level blocks (`id`, `type`, `preview`: headings in full, other
  blocks cut to ~80 characters). With `format: "blocks"`, it is the blocks (`id`, `type`,
  `markdown`, `attrs` when set), whose ids `edit_block` takes; `blockIds` or `section`
  (a heading's text) returns only those, and `includeRows` adds a table's cells as `rows`.
- `search_notes` — case-insensitive substring search over title, tags and body of
  granted notes.
- `get_authoring_guide` — the authoring reference, [`AUTHORING.md`](AUTHORING.md): everything a
  note can hold and how to write it. With no argument it returns an index; `section`
  (`native`, `editing`, `script`, `mermaid-svg`, `html`, `react`, `charts`, `design` or `examples`)
  returns only that part.

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
- `update_note` — rewrite a note's whole body (`markdown`), `title` and/or `tags`, or move
  it to another folder (`folderId`) keeping its id (`id`, each optional). A note can move
  into a folder the agent can only read; moving into a shared folder makes it public, and
  out of one into a private folder makes it private. Blocks kept exactly as `get_note`
  returned them stay untouched. Pass `modified` from `get_note` or the last write (every
  write returns it) as `expectedModified` to have the edit refused if the note changed
  since.
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
- `get_sharing` — who can see a note (`id`): `access` (`private`, `public` or `people`),
  its link unless private, the circles and people it is shared with (`with`, circles by id),
  whether it is public through a shared folder (`inSharedFolder`), and a `share_note`
  request still waiting for you (`pending`). Read access is enough.
- `share_note` — one tool for every kind of sharing (`id`, `access`, and for `people` the
  full set `with`: `{ kind: "person", id: "<identity>" }` or `{ kind: "circle", id: "<id or
  name>" }`, `role` `viewer` by default; `editor` is for circles only). Making a public note
  private happens at once. Anything else (publishing, sharing with people, changing who or
  stopping) only leaves a request: the note shows "Claude Code asks to …" with Review and
  Decline, and nothing is shared until you confirm it in the note's Share dialog. Requests are
  off until you turn on **Let agents ask to share notes** in Settings → Agent access. A note
  shared with you, or in a shared folder (use `update_note` `folderId`), can't be shared this
  way. Set `JOURNAL_MCP_APP_ORIGIN` if the links should point at another Journal than the hosted one.
  Example: *"Make my Trip plan note public and give me the link."*
- `publish_to_feed` — publish a note (`id`) to your Homebase feed as an article on your
  public channel, as **Publish to feed** in the Share dialog does; the note doesn't have to be
  public. Publishing it again updates the same post. Returns the post's `postId` and `url`.
  Images lose their metadata; a note with a cropped, rotated or flipped image has to be
  published from the Journal app. Journal MCP needs its own permission to write to your feed:
  until you give it, the tool publishes nothing and returns the link that asks you for it.
  Example: *"Publish my Trip plan note to my feed."*
- `run_script` — run JavaScript (`code`, optional `dryRun`) against your granted notes and
  get back only what it logs, for jobs that pick notes by what they say. It runs in a
  QuickJS WebAssembly sandbox with no network, files or timers; its `journal` functions call
  the tools above with the same grants. Limits per run: 10 s of CPU, 64 MB, 200 reads, 50
  writes, 8000 characters of output. A script can't trash notes or add images, and
  `dryRun: true` lists the writes without making them. The API is the
  [`script` section](AUTHORING.md#scripts-run_script) of the guide.
  Example: *"Tag every note that mentions Lisbon with lisbon."*

## Safety

Tools carry MCP annotations: `readOnlyHint` on the read tools, and `destructiveHint` on the
tools that can overwrite or remove content (`update_note`, `replace_in_note`, `edit_block`,
`delete_note`, `set_note_cover`, `clear_note_cover`, `share_note`, `publish_to_feed`, `run_script`). The server never asks for confirmation
itself: your MCP client does, so if you pick "always allow" for a write tool, its writes and
trashing happen without a prompt.

A note can hold text written to steer an agent (prompt injection), for example in something
you pasted from the web. `get_note` and `search_notes` return note content between
`untrusted-note-content` tags with a random suffix, and the `initialize` instructions tell
agents that it is data, never instructions. That lowers the risk; it can't remove it. `run_script` output is wrapped the same way, and a script can't upload a local file, so a
note can't steer one into sending a file from this computer to your notes.

**Grants are enforced by this server process, not by Homebase.** The credentials
`mcp:login` saves have Read+Write on the whole notes drive, including the grants file, and
Homebase can't scope a token to a folder. So an agent that can also run shell commands on
this computer can read those credentials and reach every note, whatever Settings → Agent
access says. Keep your client's approval prompts on for shell commands when this server is
connected, and if you think the credentials have leaked, remove the app in the owner console
(**Apps → Journal MCP**).

## What the markdown can contain

The write tools take markdown, and a note can hold much more than text: callouts, toggles,
task lists, tables, math, footnotes, images, a cover, links to other notes
(`[label](journal:note/<id>)` or `[[Note title]]`), link preview cards
(`<https://…><!-- preview -->`), and live `mermaid`, `svg`, `html` and
`react` blocks for diagrams, charts, dashboards and small interactive tools.
[`AUTHORING.md`](AUTHORING.md) is the full reference: the syntax of every block, what a
live block can load and do, the design rules and complete examples. The server returns the
same file from `get_authoring_guide`, one section at a time, and its `initialize`
instructions give agents a short summary that sends them there only for live blocks and
images.

In the app itself, pasting bare markup or a fenced block into an empty line of a note
creates the same live block.

## Why vite-node

`src/lib/homebase/config.ts` and friends use Vite's `import.meta.env` and the `@/` import
alias. `vite-node` resolves both exactly as the app does — plain `node`/`tsx` would throw
on `import.meta.env`.
