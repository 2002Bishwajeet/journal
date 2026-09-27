import { defaultSchema } from 'rehype-sanitize';

// The serializer emits author-controlled raw HTML (<u>/<sub>/<sup> marks) on top
// of `$...$` math. On a PUBLIC page that HTML must be sanitized to prevent XSS,
// so the rehype order is: parse raw HTML -> sanitize -> render math. KaTeX runs
// LAST so its (trusted) markup isn't stripped. We only widen the default schema
// to allow the three formatting tags; remark-math's class markers ride on <code>,
// which the default schema already permits, so KaTeX still finds the math.
//
// Images are stored as `attachment://<fileId>/<payloadKey>` (src/lib/yjs-utils.ts).
// The default schema only allows http(s) in `src`, so `attachment` is added
// explicitly here — nothing else is loosened, so javascript:/data: etc. are
// still stripped.
export const sanitizeSchema = {
    ...defaultSchema,
    tagNames: [...(defaultSchema.tagNames ?? []), 'u', 'sub', 'sup'],
    protocols: {
        ...defaultSchema.protocols,
        src: [...(defaultSchema.protocols?.src ?? []), 'attachment'],
    },
};
