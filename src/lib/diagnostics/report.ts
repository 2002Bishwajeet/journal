import type { PendingSyncItem } from '@/lib/db/queries/diagnostics';
import type { LogEntry } from './logBuffer';

export interface StatusRow {
    label: string;
    value: string;
}

const MAX_TEXT_LENGTH = 300;
const REPORT_LOG_LINES = 50;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Strip what must not leave the device from a message pasted into an issue or
 * chat: bearer tokens, anything named like a secret, key header, cookie or
 * token, query-string values, long token-like runs (base64, hex), and, when
 * given, note titles. Meant for error messages and log lines, not note content,
 * which the report never includes.
 */
export function redactText(text: string, titles: readonly string[] = []): string {
    let out = text
        .replace(/\b(Bearer|Basic)\s+[^\s,;"']+/gi, '$1 [redacted]')
        // A cookie header holds several name=value pairs: drop the rest of the line.
        .replace(/(\bcookie["']?\s*[:=]\s*)[^\n]*/gi, '$1[redacted]')
        .replace(
            /([\w-]*(?:authorization|secret|token|password|passwd|api[-_]?key|aes[-_]?key|bx0900|dy0810|key[-_]?header)[\w-]*["']?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&]+)/gi,
            '$1[redacted]',
        )
        .replace(/([?&][^=\s&]+=)[^&\s"']+/g, '$1[redacted]')
        .replace(/[A-Za-z0-9+/=_-]{24,}/g, (run) =>
            UUID.test(run) || (!/=$/.test(run) && (!/\d/.test(run) || !/[A-Za-z]/.test(run))) ? run : '[redacted]',
        );
    for (const title of titles) {
        if (title.trim().length >= 3) out = out.split(title).join('[title]');
    }
    return out.length > MAX_TEXT_LENGTH ? `${out.slice(0, MAX_TEXT_LENGTH)}…` : out;
}

/** A sync error in plain words, and the code to show beneath it. */
export function explainSyncError(error: { message: string; code: string | null; operation: string }): {
    plain: string;
    code: string | null;
} {
    const status = error.message.match(/\b(?:status(?: code)?|HTTP)\s*:?\s*(\d{3})\b/i)?.[1];
    const code = error.code ?? (status ? `HTTP ${status}` : null);
    const what = error.operation === 'pull' ? 'download' : error.operation === 'upload' ? 'upload this image' : 'upload this change';

    let plain: string;
    // Homebase keeps at most 25 payloads per file: the note's text, its images and its link card (#874)
    if (/too many payloads/i.test(error.message)) {
        plain = "This note has more images than your Homebase allows (25 files per note, its text included). Remove an image from the note and retry, or discard this upload.";
    } else if (status === '401') plain = 'Your sign-in was rejected. Signing out and back in usually fixes it.';
    else if (status === '403') plain = "Journal doesn't have permission for this. Check Permissions in Settings › Account.";
    else if (status === '404') plain = "The copy on your Homebase wasn't found.";
    else if (status === '409') plain = 'The copy on your Homebase changed at the same time.';
    else if (status === '413') plain = 'This is too large to send.';
    else if (status === '429') plain = 'Your Homebase asked Journal to slow down.';
    else if (status?.startsWith('5')) plain = 'Your Homebase had a problem on its side.';
    else if (/network ?error|failed to fetch|load failed|timeout|timed out|ECONN|ERR_NETWORK/i.test(error.message)) {
        plain = "Couldn't reach your Homebase. Check your connection.";
    } else plain = `Couldn't ${what}. The technical message is below.`;
    return { plain, code };
}

function formatTime(iso: string | number | null): string {
    return iso === null ? 'never' : new Date(iso).toISOString();
}

export interface ReportInput {
    status: readonly StatusRow[];
    items: readonly PendingSyncItem[];
    log: readonly LogEntry[];
    /** Off unless the owner turns it on: note and folder titles are theirs. */
    includeTitles: boolean;
    now?: number;
}

/**
 * The text the owner pastes into a GitHub issue or chat. Built only from sync
 * metadata: it has no field for note content, tokens, keys or cookies, and the
 * free text it does carry (errors, log lines) goes through redactText.
 */
export function buildReport({ status, items, log, includeTitles, now = Date.now() }: ReportInput): string {
    const titles = items.flatMap((item) => (item.title ? [item.title] : []));
    const scrub = (text: string) => redactText(text, includeTitles ? [] : titles);

    const lines = ['Journal diagnostics', `Generated: ${formatTime(now)}`, '', '== Status =='];
    for (const row of status) lines.push(`${row.label}: ${row.value}`);

    lines.push('', `== Pending items (${items.length}) ==`);
    if (items.length === 0) lines.push('None');
    items.forEach((item, index) => {
        const what = [item.kind, item.isDelete ? 'delete' : null, item.status].filter(Boolean).join(' · ');
        lines.push(`${index + 1}. ${what} · id ${item.id}`);
        if (includeTitles && item.title) lines.push(`   title: ${item.title}`);
        lines.push(
            `   retries: ${item.retryCount} · last synced: ${formatTime(item.lastSyncedAt)} · next retry: ${formatTime(item.nextRetryAt)}`,
        );
        if (item.error) {
            const { code } = explainSyncError(item.error);
            lines.push(`   error (${item.error.operation}${code ? `, ${code}` : ''}): ${scrub(item.error.message)}`);
            lines.push(`   failing since: ${formatTime(item.error.since)}`);
        }
    });

    const recent = log.slice(-REPORT_LOG_LINES);
    lines.push('', `== Recent log (last ${recent.length}) ==`);
    if (recent.length === 0) lines.push('Empty');
    for (const entry of recent) lines.push(`${formatTime(entry.at)} ${entry.level.toUpperCase()} ${scrub(entry.message)}`);

    return lines.join('\n');
}
