# CLAUDE.md - Journal App

Read `AGENTS.md` in this repository root for full project documentation: architecture, tech stack, database schema, file structure, code conventions, testing requirements, sync architecture, AI integration, and Homebase configuration.

If present locally, read `docs/FEATURE_ROADMAP.md` for the prioritized feature backlog and competitive analysis. Note: `docs/` is git-ignored (local-only) and won't exist in a fresh clone.

## Quick Reference

```bash
npm run dev        # HTTPS on dev.dotyou.cloud:5173
npm run build      # tsc + vite build
npm run test       # vitest run (serial, 30s timeout)
npm run test:watch # vitest watch mode
```

## Rules

- **Never commit unless explicitly told to do so**
- All new features must include unit tests in `src/__tests__/`
- Use Homebase SDK helpers from `@/lib/utils` — never rewrite `getNewId()`, `tryJsonParse()`, etc.
- Minimize `useState` — derive state during render when possible
- Pages only compose components; logic goes in hooks (`src/hooks/`)
- Dynamic `import()` for heavy modules (WebLLM, ImportService, ExportService)
- No `useCallback`/`useMemo` without profiling evidence
