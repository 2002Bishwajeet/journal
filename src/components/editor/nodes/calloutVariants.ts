/**
 * Callout variants (#159). Plain data with no React or TipTap imports, so the
 * headless schema, the markdown serializer and the share page can all use it.
 */
export const CALLOUT_VARIANTS = ['info', 'warning', 'tip', 'error'] as const;

export type CalloutVariant = (typeof CALLOUT_VARIANTS)[number];

/** Narrows a stored/parsed value to a known variant; anything else is `info`. */
export function toCalloutVariant(value: unknown): CalloutVariant {
  return CALLOUT_VARIANTS.includes(value as CalloutVariant) ? (value as CalloutVariant) : 'info';
}

// Obsidian/GitHub callout types (any case) -> our four variants.
const CALLOUT_TYPES: Record<string, CalloutVariant> = {
  info: 'info', note: 'info', abstract: 'info', summary: 'info', todo: 'info', question: 'info',
  tip: 'tip', hint: 'tip', important: 'tip', success: 'tip', check: 'tip', done: 'tip',
  warning: 'warning', caution: 'warning', attention: 'warning',
  danger: 'error', error: 'error', bug: 'error', failure: 'error', fail: 'error', missing: 'error',
};

/** `[!NOTE]`, `[!Caution]`, ... -> a variant; undefined for a type no callout syntax uses. */
export function knownCalloutVariant(type: string): CalloutVariant | undefined {
  return CALLOUT_TYPES[type.toLowerCase()];
}

/** Like knownCalloutVariant, but an unknown type is `info` (the importer keeps every Obsidian callout). */
export function calloutVariantFromType(type: string): CalloutVariant {
  return knownCalloutVariant(type) ?? 'info';
}

/** Container classes per variant, from theme tokens only. */
export const CALLOUT_CLASSES: Record<CalloutVariant, string> = {
  info: 'border-primary/40 bg-secondary',
  warning: 'border-collaborative bg-collaborative/10',
  tip: 'border-muted-foreground bg-accent',
  error: 'border-destructive bg-destructive/10',
};

/** Icon colour per variant. */
export const CALLOUT_ICON_CLASSES: Record<CalloutVariant, string> = {
  info: 'text-foreground',
  warning: 'text-collaborative',
  tip: 'text-muted-foreground',
  error: 'text-destructive',
};
