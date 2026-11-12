import type { ReminderEntry } from '@/lib/reminderSchedule';

export type ReminderPermission = 'granted' | 'denied' | 'prompt';

/**
 * Arms the OS's local notifications for the daily reminder (#1139). Each native platform
 * registers one; the web has none, so nothing reminder-related shows or runs there.
 */
export interface ReminderScheduler {
    permission(): Promise<ReminderPermission>;
    /** Asks the OS once; resolves with the permission afterwards. */
    requestPermission(): Promise<ReminderPermission>;
    openSystemSettings(): Promise<void>;
    /** Makes `entries` the only pending reminders. */
    replaceAll(entries: ReminderEntry[]): Promise<void>;
    cancelAll(): Promise<void>;
}

let scheduler: ReminderScheduler | null = null;
const schedulerListeners = new Set<() => void>();

export function registerReminderScheduler(impl: ReminderScheduler | null): void {
    scheduler = impl;
    schedulerListeners.forEach((listener) => listener());
}

export function getReminderScheduler(): ReminderScheduler | null {
    return scheduler;
}

export function subscribeReminderScheduler(listener: () => void): () => void {
    schedulerListeners.add(listener);
    return () => schedulerListeners.delete(listener);
}

export interface ReminderPrefs {
    enabled: boolean;
    /** Local time of day, `HH:MM`. */
    time: string;
}

export const REMINDER_PREFS_KEY = 'journal-daily-reminder';
const DEFAULT_PREFS: ReminderPrefs = { enabled: false, time: '20:00' };

let cachedRaw: string | null | undefined;
let cachedPrefs: ReminderPrefs = DEFAULT_PREFS;
const prefsListeners = new Set<() => void>();

/** This device's reminder settings. The same object until they change, for `useSyncExternalStore`. */
export function getReminderPrefs(): ReminderPrefs {
    const raw = localStorage.getItem(REMINDER_PREFS_KEY);
    if (raw !== cachedRaw) {
        cachedRaw = raw;
        try {
            cachedPrefs = { ...DEFAULT_PREFS, ...(raw ? JSON.parse(raw) : {}) };
        } catch {
            cachedPrefs = DEFAULT_PREFS;
        }
    }
    return cachedPrefs;
}

export function setReminderPrefs(change: Partial<ReminderPrefs>): void {
    localStorage.setItem(REMINDER_PREFS_KEY, JSON.stringify({ ...getReminderPrefs(), ...change }));
    prefsListeners.forEach((listener) => listener());
}

export function subscribeReminderPrefs(listener: () => void): () => void {
    prefsListeners.add(listener);
    return () => prefsListeners.delete(listener);
}

/** Sign-out: removes every pending reminder and the settings. Never throws. */
export async function clearReminders(): Promise<void> {
    localStorage.removeItem(REMINDER_PREFS_KEY);
    try {
        await scheduler?.cancelAll();
    } catch (err) {
        console.warn('[reminders] Failed to cancel on sign-out:', err);
    }
}
