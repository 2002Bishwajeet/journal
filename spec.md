# Journal - Markdown Note-Taking App

A premium, offline-first markdown note-taking app powered by **Homebase**. Built with React + TypeScript, React Query, and shadcn/ui.

> [!IMPORTANT]
> This app should feel like **Notion or Obsidian**—polished, native, and professional. Not "AI slop."

---

## Core Architecture

### Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | React + TypeScript |
| State/Data Fetching | React Query |
| UI Components | shadcn/ui |
| Editor | TipTap (ProseMirror-based) |
| Local Database | **PGlite** (Postgres in browser via WASM) |
| CRDT Sync | **Yjs** |
| Local LLM | **WebLLM** (stored in OPFS) |
| Math Rendering | KaTeX |
| Backend | Homebase (decentralized) |

### Offline-First PWA

- **Full Offline Capability:** App functions 100% without network.
- **Service Worker:** Caches app shell and assets.
- **Image Proxying:** Images from external URLs are proxied via Service Worker to satisfy `Cross-Origin-Embedder-Policy` (required for WebLLM/OPFS).

---

## Data Architecture & Persistence

### The "Two-Table" PGlite Strategy

To balance high-performance editing (Yjs) with instant search (Postgres), we use two distinct tables in PGlite:

#### 1. `document_updates` (Source of Truth)

Stores raw binary Yjs update blobs.

| Column | Type | Purpose |
|--------|------|---------|
| `doc_id` | UUID | Document identifier |
| `update_blob` | bytea | Binary Yjs update |
| `created_at` | timestamp | When update was created |

**Logic:** Every save/sync appends a binary update here. On load, fetch all updates for a `doc_id` and run `Y.applyUpdate()` to reconstruct state.

#### 2. `search_index` (Derived State)

Stores a flattened snapshot for querying and listing.

| Column | Type | Purpose |
|--------|------|---------|
| `doc_id` | UUID | Document identifier |
| `title` | text | Note title |
| `plain_text_content` | text | For FTS |
| `metadata` | JSONB | Tags, timestamps, etc. |
| `vector_embedding` | vector | pgvector for semantic search |

**Logic:**
- Updated via a **debounce (500ms)** listener on the editor.
- When user stops typing: export Yjs → Plain Text → Update this row.
- Used for Sidebar list, Full-Text Search, and Sorting.

---

## Homebase Integration

### Authentication & Drive Setup

- On authentication, create a **new Target Drive**.
- File type: `605` (Arbitrary App Constant)
- Data type: `706` (Arbitrary App Constant)
- `isEncrypted: true` (Homebase SDK handles end-to-end encryption).

### Data Model

Each note is a Homebase file containing:

```json
{
  "Metadata": {
    "title": "String",
    "folderId": "Main | uuid",
    "tags": ["String"],
    "timestamps": { "created": "Date", "modified": "Date" },
    "excludeFromAI": "Boolean"
  },
  "Payloads": {
    "content": "Binary Yjs update blob",
    "images": ["payloadKey per image"],
    "linkPreviews": ["payloadKey per preview"]
  }
}
```

### Sync Logic

1. **Pull:** Fetch new file changes from Homebase.
2. **Merge:** Apply remote binary updates to local Yjs document.
3. **Push:** Upload local binary updates to Homebase.
4. **Conflict Handling:** Handled automatically by Yjs CRDTs.

> [!NOTE]
> **Edge Case:** If Main folder is missing (due to sync error), auto-recreate it locally.

---

## Editor

### TipTap WYSIWYG Editor

Notion-like experience: renders inline as you type.

**Features:**
- Basic Markdown (Bold, Italic, Lists, Headings)
- Math Blocks (KaTeX)
- Tables (Raw markdown source with formatting helpers)
- Code blocks with syntax highlighting
- **Undo/Redo:** Standard history stack (Cmd+Z / Cmd+Shift+Z)

### Image Handling

```
User drops image
    ↓
Optimistic UI shows image immediately
    ↓
Upload starts in background
    ↓
┌─────────────┬──────────────────────────────────────┐
│ Success     │ Replace blob URL with fileId +       │
│             │ payloadKey reference                 │
├─────────────┼──────────────────────────────────────┤
│ Failure     │ After 3 retries:                     │
│ (3 retries) │ • Show error icon in image corner    │
│             │ • Hover tooltip: "Failed to upload"  │
│             │ • Click to retry                     │
└─────────────┴──────────────────────────────────────┘
```

### Mobile Experience

**Formatting Toolbar:**
- Uses `InputAccessoryView` (iOS native behavior) to sit firmly above keyboard
- Avoids layout jumps
- **Buttons:** Bold, Italic, List, Heading, Link, Image, Code

---

## Local LLM (WebLLM)

### Architecture

| Aspect | Implementation |
|--------|----------------|
| Storage | OPFS (Origin Private File System) — prevents cache eviction |
| Loading | Progressive, non-blocking UI |
| Context | Current Note + Recent Notes (unless `excludeFromAI`) |

### Job Queue System (Web Worker)

Heavy tasks (Embeddings, Action Suggestions) run in a **Background Queue**.

**Lifecycle:**
1. User types → Job queued (debounced)
2. If User closes app → Job pauses
3. App re-opens → Queue resumes processing pending jobs

> [!TIP]
> Does not block the main thread/typing.

### Features

| Feature | Behavior |
|---------|----------|
| Grammar/Spell Check | Inline underlines |
| Autocomplete | Grey text suggestion ahead of cursor |
| Action Suggestions | "Add to calendar", "Create Todo" (Batch processed) |

---

## Search

### Progressive Hybrid Search

The search experience degrades gracefully based on index status:

| Tier | Type | Availability |
|------|------|--------------|
| 1 | **Title Search** | Instant — always available via `search_index` |
| 2 | **Full-Text Search** | Fast — available once note is indexed (parsed to plain text) |
| 3 | **Semantic/Vector Search** | Slow — available after WebLLM generates embeddings |

**UI Behavior:**
- If user searches while indexing is active:
  - Return Title matches immediately
  - Show indicator: *"Indexing content... some results may be missing."*
  - Dynamically inject Semantic results as they become available

---

## Folder & Organization

### Structure

- **Flat Hierarchy:** Folders are 1 level deep (no nesting)
- **"Main" Folder:** Default destination. Cannot be deleted via UI.
- **Tags:** Secondary organization method

### Import Strategy

| Scenario | Behavior |
|----------|----------|
| Nested folders (e.g., `Work/Project/Note.md`) | Flattened to root |
| Auto-tagging | Path becomes tag: `#Work/Project` |
| Filename collisions | Append `(1)`, `(2)`, etc. |

---

## UI/UX

### Layout

#### Desktop
- Toggleable sidebar (folder list + note list)
- Tabbed notes (multiple open, like browser/IDE)
- Quick switcher (Cmd+P style)

#### Mobile
- Drill-down navigation: Folders → Notes List → Note
- Single note focus (no tabs)
- Swipe gestures for delete/archive

### Error Handling

| Scenario | Behavior |
|----------|----------|
| Token Expiry | Force re-login |
| Storage Full | Allow local-only editing with warning |

### Encryption

| Layer | V1 | V2 |
|-------|----|----|
| **Local (PGlite/IndexedDB)** | Unencrypted (acceptable for local device) | Application-level encryption |
| **Remote (Homebase)** | Encrypted via `isEncrypted: true` | Same |

### Persistence

- **Last Viewed:** Re-opens exact note and scroll position on launch
- **Sidebar:** Remembers collapse state

### Theming

- Light/Dark mode (System default)
- Stored locally

---

## Import/Export

### Export
- Single note as `.md` file
- Entire vault as `.zip` of `.md` files
- Preserve folder structure

### Import
- `.md` files
- Obsidian vault (folder structure → flattened + tagged)
- Notion export (best effort)

---

## Deferred to V2

| Feature | Notes |
|---------|-------|
| Public note sharing | Share links via Homebase public file access |
| Multi-user collaboration | Shared folders with multiple Homebase identities |
| Version history | Unlimited or last N versions |
| Application-level encryption | Encrypt before storing in IndexedDB |

---
