const DAY_MS = 86_400_000;
const MAX_SNAPSHOTS = 50;

/** UTC date of the Monday that starts `d`'s ISO week. */
function isoWeekStart(d: Date): string {
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    return monday.toISOString().slice(0, 10);
}

/**
 * Which snapshots to delete: keep everything under 24 h old, the newest per UTC
 * day up to 30 days, the newest per ISO week (UTC) after that, then cap at 50
 * by dropping the oldest. The newest snapshot is always kept.
 */
export function selectSnapshotsToPrune(
    snaps: { id: number; createdAt: Date }[],
    now: Date,
): number[] {
    const newestFirst = [...snaps].sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id,
    );
    const seen = new Set<string>();
    const keep: number[] = [];
    const prune: number[] = [];

    for (const snap of newestFirst) {
        const age = now.getTime() - snap.createdAt.getTime();
        const bucket =
            age < DAY_MS ? null
            : age < 30 * DAY_MS ? `day:${snap.createdAt.toISOString().slice(0, 10)}`
            : `week:${isoWeekStart(snap.createdAt)}`;

        if (bucket && seen.has(bucket)) {
            prune.push(snap.id);
        } else {
            if (bucket) seen.add(bucket);
            keep.push(snap.id);
        }
    }

    return prune.concat(keep.slice(MAX_SNAPSHOTS));
}
