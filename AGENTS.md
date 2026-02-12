# AGENTS.md - Journal App

## Project Overview

A premium, offline-first markdown note-taking app powered by **Homebase**. Built with React + TypeScript, React Query, shadcn/ui, TipTap editor, PGlite (WASM Postgres), Yjs CRDTs, and WebLLM.

> **Design Philosophy**: Notion/Obsidian-like - clean, minimal, professional. No gradients.

## Technology Stack

| Layer | Technology |
|-------|------------|
| Framework | React 19 + TypeScript + Vite |
| State/Data | React Query, Custom Hooks |
| UI | **shadcn/ui** + Tailwind CSS |
| Editor | TipTap (ProseMirror) + Yjs |
| Local DB | PGlite (IndexedDB persistence) |
| Backend | Homebase SDK (encrypted sync) |
| AI | WebLLM (Llama-3.2-1B in OPFS) |
| PWA | vite-plugin-pwa + Service Worker |
| Drawing | perfect-freehand + tesseract.js (OCR) |

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
│   ├── editor/           # TipTap editor + toolbar
│   │   ├── nodes/        # Custom node views (Image, Drawing)
│   │   ├── plugins/      # TipTap extensions
│   │   └── shared/       # Shared toolbar components
│   ├── layout/           # Sidebar, NoteList
│   ├── modals/           # SearchModal, Settings
│   ├── providers/        # Context providers (Sync, Online)
│   └── ui/               # shadcn components
├── hooks/
│   ├── useNotes.ts         # Note CRUD hooks
│   ├── useFolders.ts       # Folder CRUD hooks
│   ├── useSyncService.ts   # Sync status & operations
│   ├── useDrawingCanvas.ts # Drawing canvas state management
│   ├── useOnlineStatus.ts  # Offline detection
│   └── index.ts
├── lib/
│   ├── broadcast/        # Cross-tab communication (DocumentBroadcast singleton)
│   ├── db/               # PGlite database layer
│   ├── drawing/          # Drawing utilities (strokeUtils, OCR)
│   ├── homebase/         # Auth, drive, SyncService
│   ├── yjs/              # PGlite Yjs provider
│   ├── webllm/           # Grammar, autocomplete
│   ├── importexport/     # .md and .zip export/import
│   └── utils.ts          # Shared utilities (SDK + UI)
├── pages/
│   ├── EditorPage.tsx
│   ├── AuthPage.tsx
│   └── AuthFinalizePage.tsx
├── types/
└── __tests__/            # Unit tests (Vitest)
```

## Key Files

| File | Purpose |
|------|---------|
| `src/hooks/useNotes.ts` | Note CRUD & Query hooks |
| `src/hooks/useSyncService.ts` | Sync Context consumer |
| `src/hooks/useDrawingCanvas.ts` | Drawing canvas hook with stroke/shape management |
| `src/components/providers/SyncProvider.tsx` | Sync state management |
| `src/components/providers/OnlineProvider.tsx` | Online/offline detection |
| `src/lib/broadcast/DocumentBroadcast.ts` | Cross-tab/component messaging singleton |
| `src/lib/db/pglite.ts` | PGlite singleton + schema |
| `src/lib/homebase/auth.ts` | YouAuth flow |
| `src/lib/homebase/SyncService.ts` | Bidirectional Homebase sync |
| `src/lib/yjs/provider.ts` | PGlite Yjs persistence provider |
| `src/lib/webllm/engine.ts` | Grammar/autocomplete |
| `src/lib/drawing/strokeUtils.ts` | Stroke rendering with perfect-freehand |
| `src/lib/drawing/ocrService.ts` | Handwriting-to-text OCR (lazy-loaded) |
| `src/components/modals/SearchModal.tsx` | Cmd+K search |
| `src/lib/importexport/index.ts` | .md/.zip export/import |

## Editor Extensions

| Extension | File | Purpose |
|-----------|------|---------|
| Drawing | `plugins/DrawingExtension.ts` | Apple Notes-style drawing canvas with pen modes |
| Emoji | `plugins/EmojiExtension.ts` | Emoji insertion with picker |
| Code Block | Starter Kit + Lowlight | Syntax-highlighted code blocks |
| Mathematics | `@tiptap/extension-mathematics` | LaTeX math formulas |
| Tables | Table extensions | Resizable tables |

## Drawing Feature

The drawing extension provides Apple Notes-style functionality:

**Pen Modes**: Pen, Pencil, Highlighter, Scribble (OCR), Eraser
**Shapes**: Rectangle, Circle, Line, Arrow
**Key Components**:
- `DrawingNodeView.tsx` - SVG canvas component
- `DrawingToolbar.tsx` - Floating toolbar with tool selection
- `useDrawingCanvas.ts` - State management hook

OCR uses tesseract.js (lazy-loaded, cached in IndexedDB for offline).

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| ⌘K | Open search modal |
| ⌘N | Create new note |

## Homebase Configuration

- **App ID**: `f4b63f11-d2c9-4f02-9e1c-7c7fabb7e8b4`
- **File Type**: `605`
- **Data Type**: `706`
- **Drive**: `{ alias: 'f4b63f11-...', type: 'journal-notes' }`
- **Encrypted**: Yes

## Database Schema

### `document_updates`
- `doc_id` UUID, `update_blob` BYTEA, `created_at` TIMESTAMP

### `search_index`
- `doc_id` UUID PRIMARY KEY, `title` TEXT, `plain_text_content` TEXT, `metadata` JSONB

### `folders`
- `id` UUID PRIMARY KEY, `name` TEXT
- Main folder: `06cf9262-4eae-4276-b0d1-8ca3cf5be6f4`

## Development

```bash
npm install
npm run dev    # HTTPS on dev.dotyou.cloud:3000
npm run build  # Production build
npm run test   # Run unit tests
```

## Code Conventions

- **Minimize useState**: Derive state during render when possible
- **Extract hooks**: Complex state logic goes in `src/hooks/`
- **Keep pages clean**: Pages only compose components
- **Use SDK utilities**: `getNewId()`, `tryJsonParse()`, etc.

## Testing Requirements

> **IMPORTANT**: All new features MUST include unit tests.

- **Test Location**: `src/__tests__/` directory
- **Test Framework**: Vitest
- **Naming Convention**: `<feature>.test.ts`

### When to Add Tests

| Change Type | Test Required? |
|-------------|----------------|
| New utility/helper module | ✅ Yes |
| New singleton/service class | ✅ Yes |
| New database query function | ✅ Yes |
| Bug fix | ✅ Yes (regression test) |
| UI component | Optional (prefer E2E) |

### Running Tests

```bash
npm run test          # Run all tests
npm run test:watch    # Watch mode
npm run test -- broadcast  # Run specific test file
```

### Example Test Structure

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('ModuleName', () => {
    beforeEach(() => {
        // Reset state
    });

    it('should do expected behavior', () => {
        // Arrange, Act, Assert
    });
});
```

## Performance and Best Practices

- **Lazy Loading**: If a component needs to be loaded only when needed (e.g., heavy editors, expensive charts), add it to `AGENTS.md` and `pages/` as a lazy import.
- **Concurrent Features**: Use `useTransition` for non-urgent state updates to keep the UI responsive.
- **Suspense**: Wrap async components or lazy-loaded routes in `<Suspense>` boundaries. Avoid multiple nested loading states where possible.
- **Avoid Over-Optimization**: Don't use `useCallback` or `useMemo` unless profiling shows a need, or for referential stability in dependencies. Trust the React compiler/runtime.

