// Boolean feature gates for shipped-but-unpolished features. UI behind a
// false flag is hidden everywhere it surfaces; flip to true to re-enable
// while polishing. The underlying hooks/data stay intact either way.
export const FEATURES = {
    dailyNotes: false,
    templates: false,
} as const;
