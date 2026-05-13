# Find and Replace — Design Spec

> Date: 2026-05-14
> Scope: In-editor find and replace for TipTap
> Branch: feat-collaboration

---

## Problem

No way to search within a note's content. Users must visually scan or use browser Cmd+F which doesn't integrate with the editor (no replace, no match navigation, no case/whole-word options).

## Solution

A custom TipTap extension using ProseMirror's `Decoration` API for highlighting matches, plus a slim React toolbar bar that appears at the top of the editor area.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| Cmd+F | Open find bar, focus search input |
| Cmd+H | Open find bar with replace field visible |
| Enter | Next match (when find input focused) |
| Shift+Enter | Previous match (when find input focused) |
| Escape | Close find bar, clear highlights |

## Search Logic

Pure function `findMatches(doc, searchTerm, options)`:
- Iterates ProseMirror text nodes, collecting text runs with their document positions
- Finds all occurrences of `searchTerm` in the concatenated text
- Options: `caseSensitive` (default false), `wholeWord` (default false)
- Whole word uses `\b` word boundary matching
- Returns `{ from: number, to: number }[]` in document order

## Decorations

- All matches: `Decoration.inline` with class `search-highlight`
- Current match: additional class `search-highlight-current`
- CSS in `index.css`:
  - `search-highlight`: `bg-yellow-200/60 dark:bg-yellow-500/25 rounded-sm`
  - `search-highlight-current`: `bg-yellow-400 dark:bg-yellow-500/60 rounded-sm ring-1 ring-yellow-500`
- Decorations recalculated on: search term change, option toggle, doc transaction

## Extension Storage

```typescript
interface SearchState {
    searchTerm: string;
    replaceTerm: string;
    caseSensitive: boolean;
    wholeWord: boolean;
    results: { from: number; to: number }[];
    currentIndex: number;
    isOpen: boolean;
    isReplaceOpen: boolean;
}
```

## Commands

| Command | Behavior |
|---------|----------|
| `openFind` | Set `isOpen: true`, focus find input |
| `openReplace` | Set `isOpen: true, isReplaceOpen: true` |
| `closeFindReplace` | Clear state, remove decorations |
| `setSearchTerm(term)` | Update term, recalculate matches |
| `setReplaceTerm(term)` | Update replace term |
| `nextMatch` | Increment currentIndex (wrap), scroll into view |
| `prevMatch` | Decrement currentIndex (wrap), scroll into view |
| `replaceNext` | Replace current match text, advance to next |
| `replaceAll` | Replace all matches in single transaction |
| `toggleCaseSensitive` | Toggle flag, recalculate |
| `toggleWholeWord` | Toggle flag, recalculate |

## UI: FindReplaceBar

Positioned absolutely at top of editor scroll area. Two rows:
1. **Find row**: search input + match count ("3 of 12") + prev/next buttons + case/whole-word toggles + close button
2. **Replace row** (conditionally visible): replace input + replace button + replace all button

### Accessibility (Web Interface Guidelines)
- All icon buttons have `aria-label`
- Find input: `aria-label="Find in note"`, `autocomplete="off"`, `spellCheck={false}`
- Replace input: `aria-label="Replace"`, `autocomplete="off"`, `spellCheck={false}`
- Match count: `aria-live="polite"` for screen reader updates
- Keyboard navigable: Tab between fields and buttons
- `focus-visible:ring-*` on all interactive elements
- `prefers-reduced-motion`: disable scroll animation to current match

### Visual Design (Frontend Design Skill)
- Matches the app's Notion/Obsidian aesthetic: clean, compact, understated
- Semi-transparent backdrop blur background (`bg-background/95 backdrop-blur-sm`)
- Subtle border-bottom, no shadow (consistent with existing toolbar)
- Inputs use existing design tokens from shadcn
- Toggle buttons: muted default, `bg-accent` when active
- Match count in `tabular-nums` for stable width
- Smooth enter/exit via height animation (CSS `grid-rows` trick)
- Close button: `X` icon, right-aligned

## Files

| File | Action |
|------|--------|
| `src/components/editor/plugins/SearchAndReplaceExtension.ts` | Create — TipTap extension + ProseMirror plugin |
| `src/components/editor/FindReplaceBar.tsx` | Create — React UI component |
| `src/components/editor/EditorContext.tsx` | Modify — expose search state |
| `src/components/editor/plugins/extensions.ts` | Modify — add extension to base extensions |
| `src/index.css` | Modify — add highlight CSS classes |
| `src/__tests__/searchReplace.test.ts` | Create — unit tests for search logic |
| `src/hooks/useKeyboardShortcuts.ts` | No change — shortcuts handled by TipTap extension |

## Edge Cases

| Case | Handling |
|------|----------|
| Empty search term | No matches, no decorations |
| No matches found | Show "0 results" in match count |
| Search term in code block | Matches normally (searches all text nodes) |
| Replace in read-only / peer note | Replace buttons disabled |
| Very long document | Decoration recalc is synchronous ProseMirror — fast for typical note sizes |
| Special regex chars in search | Escaped before matching (literal search, not regex) |

## Not In Scope

- Regex mode
- Multi-file / cross-note search (that's the existing Cmd+K search modal)
- Search history / recent searches
