# Feature Roadmap — Journal App

> Generated: 2026-04-15
> Context: Competitive analysis vs Notion, Obsidian, Apple Notes
> Note: Sharing/collaboration feature is actively in progress on a separate track

---

## Ongoing Work

- **Circle-based sharing & collaboration** — in progress, will be a differentiator with Homebase E2E encryption
- **WebSocket real-time sync** — in progress, paused due to CORS issues

---

## Quick Wins (< 1 day each)

Small, isolated changes. Most are adding a TipTap extension or a UI toggle.

### Editor — Text Formatting
| Feature | Notes |
|---------|-------|
| Underline | Add `@tiptap/extension-underline`, toolbar button, Cmd+U |
| Subscript | Add `@tiptap/extension-subscript` |
| Superscript | Add `@tiptap/extension-superscript` |
| Clear formatting | `editor.chain().clearNodes().unsetAllMarks().run()` — one toolbar button |
| Text alignment | Add `@tiptap/extension-text-align` (left/center/right/justify) |

### Editor — Block Types
| Feature | Notes |
|---------|-------|
| H4, H5, H6 headings | Already supported by StarterKit, just unhide in toolbar/slash commands |
| Indent / outdent | List-level nesting exists; add general indent via Tab/Shift+Tab |

### Editor — Tables (Quick)
| Feature | Notes |
|---------|-------|
| Table button on mobile toolbar | Currently missing — can't insert tables on mobile at all |
| Tab navigation between cells | Verify/configure TipTap's default Tab behavior in tables |
| Column alignment (left/center/right) | CSS text-align per cell, add alignment menu to column grip |

### Editor — Advanced
| Feature | Notes |
|---------|-------|
| Find and replace | Add `@tiptap/extension-search-and-replace` or custom Cmd+F handler |
| Duplicate block | Copy current node, insert after — single command |
| Keyboard shortcuts help | Modal or tooltip listing all shortcuts |

### Note Management
| Feature | Notes |
|---------|-------|
| Trash / soft delete | Add `deletedAt` to metadata, filter from list, show trash folder |
| Note sorting options | Sort by title, created, modified — dropdown in NoteList header |
| Tags UI | Data structure already exists in `DocumentMetadata.tags` — add tag input + filter |
| Word count / reading stats | Derive from `plainTextContent` length in search_index |

### UX
| Feature | Notes |
|---------|-------|
| Focus / zen mode | Hide sidebar + note list, expand editor full-width |
| Table of contents sidebar | Parse headings from editor content, render as clickable outline |

---

## Minor Features (1–3 days each)

Require some design work or touch multiple files, but scope is bounded.

### Editor — Text Styling
| Feature | Notes |
|---------|-------|
| Text color | Add `@tiptap/extension-color` + `@tiptap/extension-text-style`, color picker popover |
| Background / highlight color | Add `@tiptap/extension-highlight` with multicolor support |
| Font size | `@tiptap/extension-text-style` + custom font-size attribute |

### Editor — Block Types
| Feature | Notes |
|---------|-------|
| Callout / admonition blocks | Custom TipTap node with icon + color variants (info/warning/tip/error) |
| Toggle / collapsible sections | Custom node wrapping content in a `<details>` element |
| Turn-into menu | Block-level menu to convert between paragraph/heading/list/quote/callout |

### Editor — Tables (Minor)
| Feature | Notes |
|---------|-------|
| Merge cells | `editor.chain().mergeCells().run()` — already in TipTap API, needs UI button |
| Split cells | `editor.chain().splitCell().run()` — already in TipTap API, needs UI button |
| Cell background color | Custom cell attribute + color picker in column/row menus |
| Duplicate table | Copy entire table node, insert after |
| Full-row / full-column selection | Click grip to select entire row/column |
| Table keyboard shortcuts | Enter (new row at end), Shift+Enter (new line in cell), Delete row/col shortcuts |

### Editor — Media
| Feature | Notes |
|---------|-------|
| Image resize | Add resize handles to ImageNode (drag corners) |
| Image caption | Add `figcaption` element below image node |
| Image alignment | Left/center/right float options on image node |
| Video embed | Support YouTube/Vimeo URLs → iframe embed node |

### Editor — Linking
| Feature | Notes |
|---------|-------|
| Internal note links `[[` | Custom input rule: `[[` triggers note search popup, inserts link to note |
| @mentions | Custom suggestion plugin: `@` triggers user/note search |
| Date mentions | Inline date chip with calendar picker |

### Editor — UX
| Feature | Notes |
|---------|-------|
| Block drag handles | Add grip icon to left of each block, enable drag-to-reorder via `@tiptap/extension-drag-handle` or ProseMirror NodeView |
| Reading mode vs edit mode | Toggle between editable and read-only with different styling |
| Typewriter scroll | Keep cursor line vertically centered as user types |

### Note Management
| Feature | Notes |
|---------|-------|
| Drag-and-drop notes between folders | DnD in NoteList + Sidebar folder targets |
| Bulk operations | Multi-select in NoteList (shift+click, Cmd+click) for move/delete/tag |
| Daily notes / journal mode | "Today's note" button, auto-create with date template, calendar view |
| Note templates | Template picker on new note, user-editable template library |

---

## Major Features (1+ week each)

Significant architectural or design work. These define the product's identity.

### Organization & Knowledge Graph
| Feature | Effort | Notes |
|---------|--------|-------|
| Nested folders / hierarchy | 1–2 weeks | Add `parentId` to folders table, tree UI in sidebar, drag-to-nest |
| Backlinks / bidirectional linking | 2–3 weeks | Link extraction on save, backlink index table, "linked mentions" panel per note |
| Graph view | 1–2 weeks | Visualize note connections (requires backlink system), force-directed layout |
| Version history | 1–2 weeks | Yjs snapshots at intervals, diff viewer, restore functionality |

### Editor — Advanced Content
| Feature | Effort | Notes |
|---------|--------|-------|
| Column / multi-column layout | 1 week | Custom node for 2–3 column grids |
| Synced blocks | 2 weeks | Shared content blocks referenced by ID, sync updates across notes |
| Web embeds / bookmark cards | 1 week | URL → rich preview card (og:title, og:image), iframe for embeds |
| File attachments | 1 week | Upload non-image files, store in Homebase, download link in note |
| Audio embed | 1 week | Audio file upload + inline player |
| Drawing / whiteboard (Apple Pencil) | 3–4 weeks | See **Drawing Deep-Dive** section below |
| Table database mode | 3–4 weeks | Notion-style: column types (text/number/date/select), sorting, filtering, formula cells. This is essentially building a spreadsheet — only pursue if it's core to the product. |
| CSV import/export for tables | 3–5 days | Parse CSV → table node, export selected table → CSV download |

### Platform & Distribution
| Feature | Effort | Notes |
|---------|--------|-------|
| Local-only mode (no Homebase) | 1 week | Allow using PGlite-only without auth, add Homebase connection later. **Biggest adoption unlock.** |
| Onboarding flow | 3–5 days | First-run tutorial, sample notes, feature highlights |
| PDF export | 3–5 days | Render note to print-friendly HTML, use browser print-to-PDF or a library |
| Custom themes / CSS | 1 week | Theme editor or CSS snippet injection (like Obsidian) |
| Web clipper / browser extension | 2 weeks | Chrome/Firefox extension to save pages/selections to journal |
| Mobile native app | 4+ weeks | React Native or Capacitor wrapper around core |
| Plugin / API system | 4+ weeks | Extension points, sandboxed plugin runtime, public API |

### Data & Collaboration
| Feature | Effort | Notes |
|---------|--------|-------|
| Real-time collaboration (WebSocket) | 3–4 weeks | Upgrade from pull-push to WebSocket-based Yjs sync |
| Database views (Notion-style) | 4+ weeks | Structured data tables with views (table, board, calendar, gallery) |
| Reminders / notifications | 1–2 weeks | Reminder dates on notes, push notifications via Service Worker |
| Global find-and-replace | 3–5 days | Search across all notes, batch replace |
| Split view / side-by-side | 1 week | Two editor panes, drag to resize |

---

## Priority Recommendation

If the goal is to make this a viable daily-driver for note-taking users:

### Phase 1 — "I can actually use this" (quick wins batch)
1. Trash / soft delete
2. Tags UI
3. Note sorting options
4. Table of contents sidebar
5. Find and replace
6. Word count
7. Underline + clear formatting

### Phase 2 — "This is better than basic notes"
8. Internal note links `[[`
9. Callout blocks
10. Toggle / collapsible sections
11. Image resize + caption
12. Daily notes / journal mode
13. Note templates
14. Text color + highlight

### Phase 3 — "I'm switching from Notion/Obsidian"
15. Nested folders
16. Backlinks + bidirectional linking
17. Version history
18. Local-only mode (no Homebase required to start)
19. Block drag handles
20. Video/web embeds

### Phase 4 — "This is my primary tool"
21. Graph view
22. Real-time collaboration
23. PDF export
24. Plugin system
25. Mobile native app

---

## Drawing Deep-Dive — Apple Pencil Support

> Goal: Match Apple Notes drawing quality on iPad with Apple Pencil

### Can we do it?

**Yes, 75–85% of Apple Notes quality is achievable in a PWA.** Safari 18.2 (Dec 2024) closed most API gaps.

### What the web platform now supports (Safari 18.2+ on iPadOS)

| Capability | Web API | Status |
|------------|---------|--------|
| Pressure sensitivity (4096 levels) | `PointerEvent.pressure` (0–1 float) | Works |
| Tilt detection | `PointerEvent.tiltX/tiltY`, `altitudeAngle`, `azimuthAngle` | Works (Safari 18.2+) |
| Palm rejection | OS-level when Apple Pencil active | Works (free) |
| Pen vs finger distinction | `PointerEvent.pointerType === "pen"` | Works |
| High-frequency input (240Hz) | `getCoalescedEvents()` | Works (Safari 18.2+) |
| Ink prediction (draw-ahead) | `getPredictedEvents()` | Works (Safari 18.2+) |
| Hover detection (M2+ iPads) | `pointermove` during hover | Works |

### Hard limitations vs native Apple Notes

| Gap | Impact | Mitigation |
|-----|--------|------------|
| **Latency**: ~30-60ms web vs ~9ms native PencilKit | Noticeable to fast writers/artists, fine for casual sketching | `getPredictedEvents()` reduces perceived latency to ~15-25ms |
| **No Ink API in Safari** | Cannot bypass browser render pipeline for ultra-low-latency inking | Chromium-only API; no workaround on Safari |
| **No simultaneous pencil + finger** | Can't "hold with finger, draw with pencil" | Safari enforces exclusive touch type; acceptable for drawing |
| **Anti-aliasing quality** | PencilKit uses Metal-accelerated rendering | Canvas 2D anti-aliasing is good but not as refined |

### Recommended architecture

**Custom build with `perfect-freehand`** — NOT tldraw or excalidraw.

| Option | Bundle Size | Reason to avoid |
|--------|-------------|-----------------|
| `perfect-freehand` | ~3-4 KB | **Recommended** — pressure-sensitive stroke math, renderer-agnostic |
| tldraw | ~1.5-2 MB | Too heavy, designed as standalone app, lacks tool variety |
| excalidraw | ~2-3 MB | Too heavy, "sketchy" aesthetic, lacks Apple Notes tools |

### Tool types to implement

| Tool | How | Apple Notes equivalent |
|------|-----|----------------------|
| Pen (monoline) | Fixed width, ignore pressure | Monoline pen |
| Fountain pen | `perfect-freehand` with real `PointerEvent.pressure` | Fountain pen |
| Marker | `globalCompositeOperation: 'source-over'`, semi-transparent, wide | Marker |
| Highlighter | `globalCompositeOperation: 'multiply'`, transparent overlay | Highlighter |
| Pencil (textured) | Vary `globalAlpha` along stroke using noise function + tilt via `altitudeAngle` | Pencil with tilt shading |
| Eraser (object) | Hit-test eraser path against stroke objects, remove matches | Object eraser |
| Eraser (pixel) | `globalCompositeOperation: 'destination-out'` | Pixel eraser |
| Ruler | Draggable/rotatable overlay, constrain strokes to ruler edge | Ruler tool |
| Lasso select | Point-in-polygon test for selection, then move/copy/delete | Lasso |
| Shape recognition | `$1 Unistroke Recognizer` or heuristic detection post-stroke | Snap-to-shape |

### TipTap integration

Custom `DrawingNode` as an `atom` block (same pattern as existing `ImageNode.tsx`):
- Inline within note (not fullscreen-only)
- Edit mode: live Canvas 2D with full tool interaction
- View mode: static PNG render (`canvas.toDataURL()`) for performance
- Slash command: `/drawing` to insert

### Storage format

```
Stroke data → compressed JSON → Homebase payload (like images)
Display → PNG data URL when not editing
```

- Simple drawing (20-30 strokes): ~5-15 KB compressed
- Moderate drawing (100+ strokes): ~50-150 KB compressed
- Complex illustration (500+ strokes): ~200-500 KB compressed

Lightweight compared to photos (500KB–5MB).

### Y.js collaboration caveat

Drawing data should sync as an opaque blob (complete serialized state on exit), not individual strokes. Real-time collaborative drawing within the same block would require a dedicated CRDT for strokes — not worth the complexity.

### Implementation phases

**Phase A (2 weeks)** — Core drawing
- Custom TipTap `DrawingNode`
- Canvas 2D rendering with `perfect-freehand`
- Pressure-sensitive pen tool
- Color picker, stroke size
- Eraser (object-level)
- Undo/redo stroke history
- Serialize/deserialize to Homebase
- `/drawing` slash command

**Phase B (1 week)** — Tool variety
- Marker, highlighter, pencil (textured) tools
- Tilt-based shading (read `altitudeAngle`/`azimuthAngle`)
- Opacity slider
- Ink prediction via `getPredictedEvents()`

**Phase C (1 week)** — Advanced
- Ruler tool
- Lasso selection + move/copy/delete
- Shape recognition (circles, rectangles, lines)
- Pinch-to-zoom on canvas
- Pixel eraser

---

## Editor Feature Comparison Matrix

| Feature | Journal | Notion | Obsidian | Apple Notes |
|---------|---------|--------|----------|-------------|
| Bold/Italic/Strike | Yes | Yes | Yes | Yes |
| Underline | **No** | Yes | Yes | Yes |
| Text color | **No** | Yes | Via plugin | **No** |
| Highlight color | **No** | Yes | Yes | **No** |
| Text alignment | **No** | Yes | Via plugin | **No** |
| H1–H3 | Yes | Yes | Yes | Yes |
| H4–H6 | **No** | Yes | Yes | **No** |
| Bullet list | Yes | Yes | Yes | Yes |
| Numbered list | Yes | Yes | Yes | Yes |
| Task list | Yes | Yes | Yes | Yes |
| Toggle/collapsible | **No** | Yes | Yes | **No** |
| Callout blocks | **No** | Yes | Yes | **No** |
| Code block | Yes | Yes | Yes | **No** |
| Table (basic) | Yes | Yes | Yes | Yes |
| Table: merge/split cells | **No** | Yes | **No** | **No** |
| Table: cell color | **No** | Yes | **No** | **No** |
| Table: column alignment | **No** | Yes | Via plugin | **No** |
| Table: sorting/filtering | **No** | Yes | **No** | **No** |
| Table: formulas | **No** | Yes | **No** | **No** |
| Table: database views | **No** | Yes | **No** | **No** |
| Table on mobile | **No** | Yes | N/A | Yes |
| Math/LaTeX | Yes | Yes | Yes | **No** |
| Drawing / whiteboard | **No** | **No** | Via plugin | Yes |
| Divider | Yes | Yes | Yes | **No** |
| Image upload | Yes | Yes | Yes | Yes |
| Image resize | **No** | Yes | Yes | Yes |
| Video embed | **No** | Yes | Yes | **No** |
| File attachment | **No** | Yes | Yes | Yes |
| Web embed | **No** | Yes | Via plugin | **No** |
| Internal links | **No** | Yes | Yes | **No** |
| Backlinks | **No** | Via mention | Yes | **No** |
| @mentions | **No** | Yes | **No** | Yes |
| Tags | **No UI** | Yes | Yes | Yes |
| Find & replace | **No** | Yes | Yes | Yes |
| Table of contents | **No** | Yes | Yes | **No** |
| Drag reorder | **No** | Yes | **No** | **No** |
| Templates | **No** | Yes | Yes | **No** |
| Version history | **No** | Yes | Via git | Yes |
| Slash commands | Yes | Yes | Yes | **No** |
| AI writing | Yes (local) | Yes (cloud) | Via plugin | Yes (cloud) |
| Offline | Yes | Partial | Yes | Yes |
| E2E encryption | Yes | **No** | Via Sync | **No** |
| Self-hosted sync | Yes | **No** | **No** | **No** |
| Local AI (on-device) | Yes | **No** | **No** | **No** |
