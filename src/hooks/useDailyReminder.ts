import { useEffect, useState, useSyncExternalStore } from 'react';
import { useLiveQuery } from '@/hooks/useLiveQuery';
import {
    getReminderPrefs,
    getReminderScheduler,
    setReminderPrefs,
    subscribeReminderPrefs,
    subscribeReminderScheduler,
    type ReminderPrefs,
    type ReminderScheduler,
} from '@/lib/native/reminders';
import { buildReminderSchedule, localDateKey } from '@/lib/reminderSchedule';

// The newest edit of any active note: the one timestamp that says whether today has been written on.
const LATEST_MODIFIED_SQL = `SELECT MAX(metadata->'timestamps'->>'modified') AS modified FROM search_index WHERE COALESCE((metadata->>'archivalStatus')::int, 0) = 0`;

const TIME_ZONE_POLL_MS = 60_000;

const currentTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

// Nothing tells a page the device's time zone changed, so look when the app returns and once a minute.
function subscribeTimeZone(onChange: () => void): () => void {
    const timer = setInterval(onChange, TIME_ZONE_POLL_MS);
    window.addEventListener('focus', onChange);
    document.addEventListener('visibilitychange', onChange);
    return () => {
        clearInterval(timer);
        window.removeEventListener('focus', onChange);
        document.removeEventListener('visibilitychange', onChange);
    };
}

/**
 * Keeps the OS's pending daily reminders in step with the setting and the notes (#1139):
 * re-arms on launch, when the app returns to the foreground, when a note is written today,
 * when the settings change and when the time zone changes; cancels everything when the
 * reminder is off. Does nothing where no scheduler is registered (the web).
 */
export function useDailyReminder(): void {
    const scheduler = useSyncExternalStore(subscribeReminderScheduler, getReminderScheduler);
    const { enabled, time } = useSyncExternalStore(subscribeReminderPrefs, getReminderPrefs);
    const timeZone = useSyncExternalStore(subscribeTimeZone, currentTimeZone);
    const armed = scheduler !== null && enabled;
    const { data, isLoading } = useLiveQuery<{ modified: string | null }>(LATEST_MODIFIED_SQL, [], 'modified', armed);
    const latest = data[0]?.modified;
    // Only the day matters: every save within a day arms the same reminders.
    const writtenDate = latest ? localDateKey(new Date(latest), timeZone) : null;

    useEffect(() => {
        // Wait for the notes, so a day already written on is never armed.
        if (!scheduler || (enabled && isLoading)) return;
        let stopped = false;
        let queue: Promise<void> = Promise.resolve();
        const run = (task: (s: ReminderScheduler) => Promise<void>) => {
            // One call at a time, so a stale arm can't land after a newer one.
            queue = queue
                .then(() => (stopped ? undefined : task(scheduler)))
                .catch((err: unknown) => console.error('[useDailyReminder] Scheduler call failed:', err));
        };

        if (!enabled) {
            run((s) => s.cancelAll());
            return () => {
                stopped = true;
            };
        }

        const arm = () =>
            run(async (s) => {
                if ((await s.permission()) !== 'granted') return;
                const writtenDates = writtenDate ? [writtenDate] : [];
                await s.replaceAll(buildReminderSchedule({ time, timeZone, now: new Date(), writtenDates }));
            });
        const onForeground = () => {
            if (document.visibilityState === 'visible') arm();
        };
        arm();
        window.addEventListener('focus', onForeground);
        document.addEventListener('visibilitychange', onForeground);
        return () => {
            stopped = true;
            window.removeEventListener('focus', onForeground);
            document.removeEventListener('visibilitychange', onForeground);
        };
    }, [scheduler, enabled, isLoading, time, timeZone, writtenDate]);
}

export interface DailyReminderSettings {
    /** False until a scheduler is registered: show no row (the web). */
    available: boolean;
    prefs: ReminderPrefs;
    /** The OS refused notifications; the switch stays off and the row offers system settings. */
    denied: boolean;
    setEnabled: (on: boolean) => Promise<void>;
    setTime: (time: string) => void;
    openSystemSettings: () => Promise<void>;
}

/** The Settings -> Notifications "Daily reminder" row's state and actions. */
export function useDailyReminderSettings(): DailyReminderSettings {
    const scheduler = useSyncExternalStore(subscribeReminderScheduler, getReminderScheduler);
    const prefs = useSyncExternalStore(subscribeReminderPrefs, getReminderPrefs);
    const [denied, setDenied] = useState(false);

    return {
        available: scheduler !== null,
        prefs,
        denied,
        setEnabled: async (on) => {
            if (!scheduler) return;
            if (!on) {
                setDenied(false);
                setReminderPrefs({ enabled: false });
                return;
            }
            let permission = await scheduler.permission();
            if (permission === 'prompt') permission = await scheduler.requestPermission();
            setDenied(permission !== 'granted');
            setReminderPrefs({ enabled: permission === 'granted' });
        },
        setTime: (time) => {
            if (time) setReminderPrefs({ time });
        },
        openSystemSettings: async () => {
            await scheduler?.openSystemSettings();
        },
    };
}
