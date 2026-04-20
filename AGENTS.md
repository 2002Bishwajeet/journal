# AGENTS.md - Journal App

## Project Overview

A premium, offline-first markdown note-taking app powered by **Homebase**. Built with React + TypeScript, React Query, shadcn/ui, TipTap editor, PGlite (WASM Postgres), Yjs CRDTs, and WebLLM.

> **Design Philosophy**: Notion/Obsidian-like — clean, minimal, professional. No gradients.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 + TypeScript 6 + Vite 8 |
| State/Data | React Query (@tanstack), Custom Hooks |
| UI | **shadcn/ui** + Tailwind CSS 4.2 + Radix UI |
| Editor | TipTap 3.22 (ProseMirror) + Yjs |
| Local DB | PGlite 0.4.x (IndexedDB persistence, pg_trgm) |
| Backend | Homebase SDK 0.0.7-alpha (encrypted sync) |
| AI | WebLLM — Qwen2.5-1.5B default, 4 models available |
| PWA | vite-plugin-pwa + Service Worker |
| Animations | Framer Motion |
| Testing | Vitest |

## SDK Utilities

**Always use Homebase SDK helpers** instead of writing custom utilities:

```typescript
import { getNewId, tryJsonParse, base64ToUint8Array } from '@/lib/utils';
// These re-export from @homebase-id/js-lib/helpers
```

## Project Structure

```
src/
├── components/
│   ├── editor/
│   │   ├── hooks/              # useImageDeletionTracker
│   │   ├── nodes/              # ImageNode custom renderer
│   │   ├── plugins/            # Grammar, Autocomplete, FileHandler, Emoji, Shortcuts, SlashCommands/
│   │   ├── shared/             # Shared toolbar components
│   │   ├── table/              # TableColumnMenu, TableRowMenu
│   │   ├── AIMenu.tsx          # AI rewrite dropdown
│   │   ├── AISuggestionOverlay.tsx
│   │   ├── BubbleMenuToolbar.tsx
│   │   ├── EditorContext.tsx
│   │   ├── EditorProvider.tsx  # Y.js doc init, extension config, image uploads
│   │   ├── EditorToolbar.tsx   # Desktop toolbar
│   │   ├── EmojiPicker.tsx
│   │   ├── MobileToolbar.tsx   # Touch toolbar with safe-area
│   │   ├── TablePicker.tsx
│   │   └── TipTapEditor.tsx
│   ├── layout/
│   │   ├── ChatBot.tsx         # Per-note AI chat sidebar
│   │   ├── NoteList.tsx        # Date-grouped notes with swipe/context menu
│   │   ├── Sidebar.tsx         # Folders, search, settings
│   │   ├── SplashScreen.tsx
│   │   ├── SyncStatus.tsx
│   │   └── TabBar.tsx          # Desktop multi-tab editing
│   ├── modals/
│   │   ├── ConfirmDialog.tsx
│   │   ├── ConflictModal.tsx
│   │   ├── CreateFolderModal.tsx
│   │   ├── ExtendPermissionDialog.tsx
│   │   ├── SearchModal.tsx     # Cmd+K full-text + fuzzy search
│   │   ├── SettingsModal.tsx   # General, AI & Models, Data, About tabs
│   │   └── ShareDialog.tsx
│   ├── auth/                   # AuthGuard, DotYouClientProvider
│   ├── providers/
│   │   ├── OnlineProvider.tsx
│   │   └── SyncProvider.tsx    # Bidirectional sync orchestration
│   ├── pwa/
│   │   └── UpdatePrompt.tsx
│   └── ui/                     # shadcn/radix primitives
├── hooks/
│   ├── auth/                   # useAuth, useVerifyToken, useYouAuthAuthorization
│   ├── useAISettings.ts        # AI feature toggles (localStorage, cross-tab sync)
│   ├── useDeviceType.ts        # mobile | tablet | desktop detection
│   ├── useDocumentCache.ts     # LRU cache (max 10 docs)
│   ├── useDocumentSubscription.ts  # BroadcastChannel listener for remote updates
│   ├── useFolders.ts           # Folder CRUD with optimistic updates
│   ├── useKeyboardShortcuts.ts
│   ├── useNotes.ts             # Note CRUD, pin, delete with remote cleanup
│   ├── useRecentEmojis.ts
│   ├── useSearchModal.ts       # Debounced search, keyboard nav
│   ├── useSessionPersistence.ts # Last note/folder, scroll position
│   ├── useSettingsModal.ts     # Export/import handlers
│   ├── useTabManager.ts        # Multi-tab state (max 10, persisted)
│   ├── useThemePreference.ts   # light | dark | system
│   ├── useSyncService.ts       # SyncContext consumer
│   └── useWebLLM.ts            # Lazy-loaded AI engine with idle GC
├── lib/
│   ├── broadcast/
│   │   └── DocumentBroadcast.ts  # Singleton, BroadcastChannel API
│   ├── db/
│   │   ├── pglite.ts           # PGlite singleton + schema (9 tables)
│   │   └── queries.ts          # All SQL queries (~50 functions)
│   ├── homebase/
│   │   ├── config.ts           # App IDs, drive, file/data types, payload keys
│   │   ├── FolderDriveProvider.ts
│   │   ├── NotesDriveProvider.ts
│   │   ├── SyncService.ts      # Pull/push orchestration
│   │   └── InboxProcessor.ts   # Remote change processing
│   ├── importexport/
│   │   ├── ExportService.ts    # .md/.zip with YAML frontmatter
│   │   ├── ImportService.ts
│   │   └── notionImport.ts
│   ├── search/
│   │   └── searchService.ts    # Web search via SearXNG
│   ├── utils/
│   │   ├── hash.ts
│   │   ├── imageProxy.ts
│   │   ├── markdownTableParser.ts
│   │   ├── memoryMonitor.ts
│   │   └── sw-safety.ts
│   ├── webllm/
│   │   ├── engine.ts           # Grammar, autocomplete, rewrite, chat
│   │   ├── models.ts           # Model registry (Qwen2.5-1.5B, SmolLM2-360M, etc.)
│   │   └── index.ts
│   ├── workers/
│   │   ├── jobQueue.ts         # Background job queue
│   │   └── jobQueueWorker.ts
│   ├── yjs/
│   │   └── provider.ts         # PGliteProvider — Yjs persistence + auto-compaction
│   └── utils.ts                # Re-exports from Homebase SDK + UI helpers
├── pages/
│   ├── Landing.tsx             # Welcome / login screen
│   ├── AuthFinalizePage.tsx    # OAuth callback
│   ├── EditorPage.tsx          # Main editor with toolbar
│   ├── EmptyEditorPage.tsx     # No-note-selected state
│   ├── ChatBotPage.tsx         # Full-screen AI chat
│   ├── SharePage.tsx           # Public read-only note
│   ├── ShareTargetPage.tsx     # PWA share target receiver
│   └── index.ts
├── helpers/
│   └── dateGrouping.ts         # Today, Yesterday, Last Week, etc.
├── types/
│   └── index.ts                # All TypeScript interfaces
├── styles/
│   └── syntax.css              # Code block highlighting
├── App.tsx                     # Router + Provider stack
├── main.tsx                    # Entry point
├── index.css                   # Tailwind + custom CSS variables
└── sw.ts                       # Service Worker
```

## Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useNotes.ts` | Note CRUD, pin, delete with remote cleanup |
| `src/hooks/useFolders.ts` | Folder CRUD with optimistic updates |
| `src/hooks/useAISettings.ts` | AI feature toggles, model selection |
| `src/hooks/useWebLLM.ts` | Lazy-loaded WebLLM with idle GC |
| `src/hooks/useTabManager.ts` | Multi-tab editing state |
| `src/hooks/useSessionPersistence.ts` | Last note, scroll positions |
| `src/hooks/useSyncService.ts` | Sync context consumer |
| `src/components/providers/SyncProvider.tsx` | Sync state + auto-sync interval |
| `src/components/editor/EditorProvider.tsx` | Y.js doc init, extensions, image upload |
| `src/components/editor/plugins/extensions.ts` | TipTap extension list |
| `src/components/editor/plugins/GrammarPlugin.ts` | AI grammar with hallucination guards |
| `src/components/editor/plugins/AutocompletePlugin.ts` | Ghost text suggestions |
| `src/components/modals/SettingsModal.tsx` | Settings: General, AI, Data, About |
| `src/components/modals/SearchModal.tsx` | Cmd+K search |
| `src/lib/broadcast/DocumentBroadcast.ts` | Cross-tab messaging singleton |
| `src/lib/db/pglite.ts` | PGlite singleton + schema + migrations |
| `src/lib/db/queries.ts` | All SQL queries (~50 functions) |
| `src/lib/homebase/config.ts` | App IDs, drive config, payload keys |
| `src/lib/homebase/SyncService.ts` | Bidirectional Homebase sync |
| `src/lib/yjs/provider.ts` | PGlite Yjs persistence + auto-compaction |
| `src/lib/webllm/engine.ts` | Grammar, autocomplete, rewrite, chat |
| `src/lib/webllm/models.ts` | Available model registry |
| `src/lib/importexport/` | .md/.zip export/import + Notion import |

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+K | Open search modal |
| Cmd+N | Create new note |
| Cmd+S | Save / trigger sync |
| Cmd+B | Bold |
| Cmd+I | Italic |
| Cmd+E | Inline code |
| Cmd+Shift+X | Strikethrough |
| Cmd+Shift+K | Add/edit link |
| Cmd+Shift+7 | Ordered list |
| Cmd+Shift+8 | Bullet list |
| Cmd+Shift+9 | Task list |
| Cmd+Z | Undo (Yjs-aware) |
| Cmd+Y / Cmd+Shift+Z | Redo (Yjs-aware) |
| Tab | Accept autocomplete suggestion |
| Escape | Dismiss autocomplete / slash commands |
| / | Open slash command menu |

## Homebase Configuration

| Constant | Dev | Prod |
|----------|-----|------|
| App ID | `38e160f1f815438a89eabc3a261e9952` | `c762ee784274473480919d8080d7a825` |
| Note File Type | `605` | `605` |
| Note Data Type | `706` | `706` |
| Folder File Type | `606` | `606` |
| Folder Data Type | `707` | `707` |
| Drive Alias | `d5f411fa83fd4854a3bd7e974cc9bca9` | same |
| Drive Type | `30743710039d4b97bbd352f343d1c9df` | same |
| Main Folder ID | `06cf9262-4eae-4276-b0d1-8ca3cf5be6f4` | same |
| Content Payload Key | `jrnl_txt` | same |
| Image Payload Prefix | `jrnl_img` | same |

## Database Schema (PGlite — 9 Tables)

### `document_updates` — Yjs source of truth
- `id` SERIAL PK, `doc_id` UUID, `update_blob` BYTEA, `created_at` TIMESTAMPTZ
- Index: `idx_document_updates_doc_id` on doc_id

### `search_index` — Derived state for FTS and list rendering
- `doc_id` UUID PK, `title` TEXT, `plain_text_content` TEXT, `metadata` JSONB, `vector_embedding` REAL[], `search_vector` tsvector, `updated_at` TIMESTAMPTZ
- Indexes: GIN on search_vector, GIN trigram on title + content, GIN on metadata

### `folders`
- `id` UUID PK, `name` TEXT, `created_at` TIMESTAMPTZ
- Main folder auto-created: `06cf9262-4eae-4276-b0d1-8ca3cf5be6f4`

### `sync_records` — Local-to-remote mapping
- `local_id` UUID PK, `entity_type` TEXT, `remote_file_id` TEXT, `version_tag` TEXT, `last_synced_at` TIMESTAMPTZ, `sync_status` TEXT, `content_hash` TEXT, `encrypted_key_header` TEXT
- Status values: `pending`, `synced`, `error`, `conflict`

### `pending_image_uploads` — Retry queue
- `id` UUID PK, `note_doc_id` UUID, `blob_data` BYTEA, `content_type` TEXT, `status` TEXT, `retry_count` INT, `payload_key` TEXT, `next_retry_at` TIMESTAMPTZ, `created_at` TIMESTAMPTZ

### `pending_image_deletions`
- `id` SERIAL PK, `note_doc_id` UUID, `payload_key` TEXT, UNIQUE(note_doc_id, payload_key)

### `sync_errors` — Error tracking with retry
- `id` SERIAL PK, `entity_id` UUID, `entity_type` TEXT, `operation` TEXT, `error_message` TEXT, `error_code` TEXT, `retry_count` INT, `next_retry_at` TIMESTAMPTZ, `created_at` TIMESTAMPTZ, `resolved_at` TIMESTAMPTZ

### `job_queue` — Background tasks
- `id` SERIAL PK, `job_type` TEXT, `payload` JSONB, `status` TEXT, `error_message` TEXT, `created_at` TIMESTAMPTZ, `processed_at` TIMESTAMPTZ

### `app_state` — Session persistence (key-value)
- `key` TEXT PK, `value` JSONB, `updated_at` TIMESTAMPTZ

## AI Integration

### Available Models (`src/lib/webllm/models.ts`)

| Model | Size | Memory | Recommended |
|-------|------|--------|-------------|
| Qwen2.5-1.5B | ~900 MB | ~1.2 GB | Yes (default) |
| SmolLM2-360M | ~250 MB | ~400 MB | Low-end devices |
| Qwen2.5-0.5B | ~350 MB | ~500 MB | Lightweight |
| Llama-3.2-1B (Legacy) | ~700 MB | ~1.5 GB | No |

### AI Features
- **Grammar checking**: GrammarPlugin with inline wavy underlines, 3s debounce, hallucination filtering
- **Autocomplete**: Ghost text via AutocompletePlugin, 2s debounce, Tab to accept
- **Rewrite**: 8 styles — Proofread, Rewrite, Friendly, Professional, Concise, Summary, Key Points, List/Table
- **Chat**: Per-note AI chat sidebar (ChatBot component)
- **Slash commands**: `/ask`, `/summarize`, `/rewrite` via AI suggestion overlay
- **Idle GC**: Auto-unloads model after 5 minutes idle to reclaim ~2-3 GB memory
- **Mobile**: Disabled on mobile devices (insufficient memory)

### Settings
- Stored in `localStorage['journal-ai-settings']`
- Cross-tab sync via StorageEvent
- Toggles: enabled, autocompleteEnabled, grammarEnabled, modelId

## Development

```bash
npm install
npm run dev      # HTTPS on dev.dotyou.cloud:5173
npm run build    # tsc + vite build
npm run test     # vitest run
npm run test:watch
npm run test:ui  # visual dashboard
```

**Dev server requires**: Self-signed HTTPS cert (`dev-dotyou-cloud.crt/key`) and `Cross-Origin-Embedder-Policy: require-corp` header (for WebLLM/OPFS).

## Code Conventions

- **Minimize useState**: Derive state during render when possible
- **Extract hooks**: Complex state logic goes in `src/hooks/`
- **Keep pages clean**: Pages only compose components
- **Use SDK utilities**: `getNewId()`, `tryJsonParse()`, `base64ToUint8Array()` from `@/lib/utils`
- **Lazy loading**: Dynamic imports for heavy modules (WebLLM ~7MB, ImportService, ExportService)
- **Avoid over-optimization**: No `useCallback`/`useMemo` unless profiling shows need
- **No `any` type**: Always use proper types. Use library-provided types (e.g. `CommandProps` from `@tiptap/core`), module augmentation (`declare global`/`declare module`), or generics instead of `any`. If there is genuinely no way to avoid `any`, stop and explain why to the user before proceeding.

## Testing Requirements

> **IMPORTANT**: All new features MUST include unit tests.

- **Location**: `src/__tests__/`
- **Framework**: Vitest (30s timeout, serial execution)
- **Naming**: `<feature>.test.ts`

### Existing Tests

| File | Covers |
|------|--------|
| `database.test.ts` | PGlite schema, CRUD operations |
| `queries.test.ts` | Query functions, search, sync records |
| `broadcast.test.ts` | DocumentBroadcast messaging |
| `sync.test.ts` | SyncService push/pull/conflicts |
| `sync_optimization.test.ts` | Version conflicts, retries |
| `importexport.test.ts` | Markdown/ZIP export/import |
| `aiSettings.test.ts` | AI configuration persistence |

### When to Add Tests

| Change Type | Test Required? |
|-------------|----------------|
| New utility/helper module | Yes |
| New singleton/service class | Yes |
| New database query function | Yes |
| Bug fix | Yes (regression test) |
| UI component | Optional (prefer E2E) |

## Performance and Best Practices

- **Lazy Loading**: Heavy modules (WebLLM, ImportService, ExportService) use dynamic `import()`
- **Concurrent Features**: `useTransition` for non-urgent state updates
- **Suspense**: Wrap async components in `<Suspense>` boundaries
- **Debouncing**: Editor → search_index (500ms), grammar (3s), autocomplete (2s), search (150ms), session save (500ms)
- **Yjs Compaction**: Auto-compact after 50 updates
- **Query Caching**: React Query with offline persistence (24h TTL)
- **Code Splitting**: Manual Vite chunks for WebLLM, PGlite, TipTap, UI

## Sync Architecture

Bidirectional sync with Yjs CRDTs for conflict resolution:

1. **SyncProvider** — React context, auto-syncs every 15s + on online event
2. **SyncService** (`src/lib/homebase/SyncService.ts`) — Pull/push orchestration
3. **PGliteProvider** (`src/lib/yjs/provider.ts`) — Persists Yjs updates, auto-compaction
4. **DocumentBroadcast** (`src/lib/broadcast/DocumentBroadcast.ts`) — Cross-tab sync

### Sync Flow

```
Editor (Yjs) ←→ PGliteProvider ←→ DocumentBroadcast ←→ SyncService ←→ Homebase
                                                              ↓
                                                     InboxProcessor (pull)
                                                     NotesDriveProvider (push)
                                                     FolderDriveProvider (push)
```

### Sync Lifecycle
1. Flush all active PGliteProviders (pending edits → DB)
2. Pull remote changes via InboxProcessor
3. Merge Yjs documents for conflicts (CRDT)
4. Push local pending changes (folders sequential, notes parallel ×5)
5. Process pending image uploads (exponential backoff)
6. Update sync status in UI

### DocumentBroadcast API

```typescript
import { documentBroadcast } from '@/lib/broadcast';

documentBroadcast.notifyDocumentUpdated(docId);     // Notify editors to reload
await documentBroadcast.requestFlushAndWait();        // Flush all providers
const unsub = documentBroadcast.subscribe(handler);   // Listen for messages
```

## Routes

| Path | Component | Auth |
|------|-----------|------|
| `/` | RootRedirect | Yes |
| `/:folderId` | EmptyEditorPage | Yes |
| `/:folderId/:noteId` | EditorPage | Yes |
| `/:folderId/:noteId/chat` | ChatBotPage | Yes |
| `/share-target` | ShareTargetPage | Yes |
| `/welcome` | Landing | No |
| `/auth/finalize` | AuthFinalizePage | No |
| `/share/:identity/:noteId` | SharePage | No |

## Metadata Schema (JSONB in search_index)

```json
{
  "title": "string",
  "folderId": "UUID",
  "tags": ["string"],
  "timestamps": { "created": "ISO8601", "modified": "ISO8601" },
  "excludeFromAI": "boolean",
  "isPinned": "boolean",
  "isCollaborative": "boolean",
  "circleIds": ["UUID"],
  "recipients": ["OdinId"],
  "lastEditedBy": "OdinId"
}
```
