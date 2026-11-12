/** Where a tap on a reminder goes: today's note. */
export const REMINDER_URL = 'journal://today';

const TITLE = 'Journal';

/** Fixed prompts, picked by date. Never note content. */
export const REMINDER_PROMPTS = [
    "What's on your mind today?",
    'How was your day? Take a minute to write it down.',
    'What is one thing you noticed today?',
    'What are you grateful for right now?',
    'What would you like to remember about today?',
    'Anything you want to get off your mind?',
    'What made today different?',
] as const;

/** One reminder, as a local wall-clock time. The OS keeps the time across DST changes. */
export interface ReminderEntry {
    /** Stable per day, so a replaced entry keeps its identity. */
    id: string;
    /** Local date, `YYYY-MM-DD`. */
    date: string;
    /** Local time, `HH:MM`. */
    time: string;
    /** `date` and `time` together, `YYYY-MM-DDTHH:MM`. */
    at: string;
    /** IANA zone the wall-clock time is in. */
    timeZone: string;
    title: string;
    body: string;
    /** Opened when the user taps the notification. */
    url: string;
}

export interface ReminderScheduleInput {
    /** Local time of day, `HH:MM`. */
    time: string;
    /** IANA zone the user is in now. */
    timeZone: string;
    now: Date;
    /** Local dates (`YYYY-MM-DD`) on which a note was created or edited. */
    writtenDates: readonly string[];
    /** How many calendar days to cover, from the next fire time. */
    days?: number;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The date (`YYYY-MM-DD`) and time (`HH:MM`) on the wall clock in `timeZone` at `instant`. */
function wallClock(instant: Date, timeZone: string): { date: string; time: string } {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
    }).formatToParts(instant);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    return { date: `${get('year')}-${get('month')}-${get('day')}`, time: `${get('hour')}:${get('minute')}` };
}

/** The local date (`YYYY-MM-DD`) of `instant` in `timeZone`. */
export function localDateKey(instant: Date, timeZone: string): string {
    return wallClock(instant, timeZone).date;
}

function addDays(date: string, offset: number): string {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + offset)).toISOString().slice(0, 10);
}

function promptFor(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    const day = Math.floor(Date.UTC(y, m - 1, d) / 86_400_000);
    return REMINDER_PROMPTS[day % REMINDER_PROMPTS.length];
}

/**
 * The reminders to arm: one per local day at `time`, for `days` days from the next fire
 * time, leaving out days the user already wrote on. Pure: the same input always gives the
 * same output. Entries are wall-clock times, so the local time holds across DST changes,
 * and a new `timeZone` moves every entry to the same time on the new clock.
 */
export function buildReminderSchedule({ time, timeZone, now, writtenDates, days = 14 }: ReminderScheduleInput): ReminderEntry[] {
    if (!TIME_PATTERN.test(time)) throw new RangeError(`Invalid reminder time: ${time}`);
    const current = wallClock(now, timeZone);
    const first = time > current.time ? current.date : addDays(current.date, 1);
    const written = new Set(writtenDates);

    const entries: ReminderEntry[] = [];
    for (let i = 0; i < days; i++) {
        const date = addDays(first, i);
        if (written.has(date)) continue;
        entries.push({
            id: `daily-reminder-${date}`,
            date,
            time,
            at: `${date}T${time}`,
            timeZone,
            title: TITLE,
            body: promptFor(date),
            url: REMINDER_URL,
        });
    }
    return entries;
}
