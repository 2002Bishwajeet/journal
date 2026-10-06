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
- It can import from `react`, `recharts` and `lucide-react`, and from nothing else: any
  other import shows "A react block can import only react, recharts and lucide-react,
  not …" in the frame. All three come with Journal, so a block needs no network and works
  offline. TypeScript is not supported.
- `className` takes Tailwind classes, drawn in Journal's theme (below).
- `recharts` charts are drawn in the theme without colour props (below).
- `lucide-react` icons draw in `currentColor`, so they take the text colour around them:
  `<Heart className="size-4 text-muted-foreground" />`.
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

#### Tailwind in a `react` block

A `react` block gets a fixed Tailwind stylesheet, built with Journal and drawn in its
theme. It follows the light and dark theme by itself: no `dark:` variant is needed, and
`dark:` classes do nothing. Classes outside this list also do nothing. There is no
preflight: the frame keeps the note's font, and unstyled buttons, inputs and tables
still look like Journal's.

| Family | Classes |
|---|---|
| Layout | `block` `inline-block` `inline` `flex` `inline-flex` `grid` `inline-grid` `hidden` `contents`, `flex-row` `flex-col` (and `-reverse`) `flex-wrap` `flex-nowrap` `flex-1` `flex-auto` `flex-none` `grow` `shrink-0`, `items-*` `justify-*` `self-*` `content-*` `place-items-center`, `grid-cols-1`…`12` `col-span-1`…`12`/`full` `grid-rows-1`…`6` `row-span-*`, `gap-*` `gap-x-*` `gap-y-*` `space-x-*` `space-y-*`, `relative` `absolute` `sticky` `inset-*` `top-*` …, `z-*`, `overflow-*`, `aspect-square` `aspect-video`, `object-cover` `object-contain` |
| Spacing | `p` `px` `py` `pt` `pr` `pb` `pl` `m` `mx` `my` `mt` `mr` `mb` `ml`, `0` to `24` on Tailwind's scale, and `m*-auto` |
| Sizing | `w-*` `h-*` `size-*` (the spacing scale up to `96`, `auto` `full` `fit` `min` `max` and halves to quarters), `w-screen` `h-screen`, `min-w-*` `min-h-*`, `max-w-xs`…`4xl` `max-w-prose` `max-w-full`, `max-h-*` |
| Typography | `text-xs`…`text-6xl`, `font-sans` (the note's font) `font-mono`, `font-light`…`font-extrabold`, `leading-*` `tracking-*`, `text-left` `text-center` `text-right` `text-justify`, `truncate` `line-clamp-1`…`3` `break-words` `whitespace-*`, `uppercase` `italic` `underline` `tabular-nums` |
| Borders | `border` `border-0` `border-2` `border-4` and each side, `border-dashed` `border-dotted`, `divide-x` `divide-y`, `rounded` `rounded-sm`…`rounded-full` and each side, `ring` `ring-0`…`ring-4` `ring-inset` |
| Effects | `opacity-*`, `shadow` `shadow-sm`…`shadow-2xl` (all one hairline: the note is flat), `transition` `transition-colors` `duration-100` `200` `300` `ease-*`, `cursor-pointer` `select-none` `sr-only` |
| Colours | `bg-*` `text-*` `border-*` `from-*` `via-*` `to-*` with `bg-gradient-to-*` or `bg-linear-to-*`, and `hover:bg-*`: every colour name below. `ring-*` `divide-*` `hover:text-*` `hover:border-*`: the theme names and the grays. `fill-*` `stroke-*` `focus-visible:ring-*` `focus-visible:border-*`: the theme names, `white`, `black` and `current` |
| Variants | `hover:` and `focus-visible:` on the colours above, `hover:opacity-*`, `focus-visible:ring-*` `focus-visible:outline-none`; `sm:` on display, flex direction, `grid-cols-*`, `col-span-*` and text size. The frame is about 650px wide, so `md:` and wider never apply |

A bare `border`, `divide-y` or `ring` is drawn in `--border` or `--ring`.

The colour names are the theme's: `background` `foreground` `card` `card-foreground`
`popover` `popover-foreground` `primary` `primary-foreground` `secondary`
`secondary-foreground` `muted` `muted-foreground` `accent` `accent-foreground`
`destructive` `destructive-foreground` `border` `input` `ring` `chart-1`…`chart-5`, and
`transparent` `current` `inherit`. Prefer them. Tailwind's palette names work too, mapped
to the theme so that a block written for stock Tailwind still matches the note:

| Tailwind name | Drawn in |
|---|---|
| `white`, `black` | `--background`, `--foreground` |
| `slate` `gray` `zinc` `neutral` `stone` 50–200 | `--muted` |
| the same, 300 | `--border` |
| the same, 400–600 | `--muted-foreground` |
| the same, 700–950 | `--foreground` |
| `red` `orange` `pink` `rose` | `--chart-2` |
| `green` `emerald` `lime` `teal` | `--chart-3` |
| `amber` `yellow` | `--chart-4` |
| `blue` `indigo` `sky` `cyan` `violet` `purple` `fuchsia` | `--chart-5` |

No hue is drawn in `--chart-1`: it is nearly the text colour.

A hue's shades 300–600 are its chart colour itself. Shades 50, 100 and 200 are that colour
washed into `--background` (12%, 20% and 32% of it), and shades 700, 800, 900 and 950 are
it taken towards `--foreground` (80%, 65%, 50% and 35% of it). So `bg-blue-50 text-blue-900`
is a pale panel with strong text in both themes, and `bg-blue-500 text-white` a strong
button. Opacity modifiers such as `bg-blue-500/50` are not in the sheet.

#### Charts in a `react` block

`recharts` is Recharts 3, drawn in Journal's theme. Leave the colour props out:

- Series take `--chart-1` … `--chart-5` in the order they appear: `Line`, `Area` and
  `Radar` their line and fill, `Bar` and `Scatter` their fill. A `Pie` gives each sector
  the next colour.
- `CartesianGrid` and `PolarGrid` use `--border`. `XAxis`, `YAxis` and the polar axes draw
  their lines in `--border` and their tick labels in `--muted-foreground`.
- `Tooltip` and `Legend` text is `--foreground`, the tooltip on `--background`.
- A colour the block sets wins, except the sample colours of the Recharts docs:
  `#8884d8`, `#82ca9d`, `#ffc658`, `#ff7300` and `#413ea0` become `--chart-1` …
  `--chart-5`.

Wrap a chart in `ResponsiveContainer` with a fixed height, so that it fills the note's
width:

````markdown
```react
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp } from 'lucide-react';

const data = [
  { day: 'Mon', words: 420, edits: 12 },
  { day: 'Tue', words: 380, edits: 18 },
  { day: 'Wed', words: 610, edits: 9 },
];

export default function App() {
  return (
    <div className="space-y-2">
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <TrendingUp className="size-4" /> Words written this week
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="day" />
          <YAxis />
          <Tooltip />
          <Line dataKey="words" />
          <Line dataKey="edits" />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```
````

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

The chart palette is five muted inks. Use them in order for data series, and never raw
colours: the first is the one used most, so it is the calmest. Each has at least 3:1
contrast with the note's background, so the background reads as a label on any of them.

| Variable | Role | Light | Dark |
|---|---|---|---|
| `--chart-1` | Ink: the main series | `#39362E` | `#DBD9D2` |
| `--chart-2` | Clay | `#8A5344` | `#CCABA1` |
| `--chart-3` | Sage | `#718968` | `#86977D` |
| `--chart-4` | Ochre | `#9D7F42` | `#BF9F68` |
| `--chart-5` | Slate | `#4F7A96` | `#7FA1B7` |

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
