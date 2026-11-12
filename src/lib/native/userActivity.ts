import { hasNativePlugin, invokeNative, nativePlatform } from '@/lib/native';

// Handoff (#1147): the macOS app advertises the open note as an NSUserActivity through the
// premium plugin (native/rust/user_activity.rs). A continued activity or a Spotlight tap
// comes back as a journal://note/<id> link (useNativeDeepLink).
const PLUGIN = 'journal-user-activity';

const hasUserActivity = () => nativePlatform() === 'macos' && hasNativePlugin(PLUGIN);

const call = (command: string, args?: Record<string, unknown>) =>
    hasUserActivity()
        ? invokeNative(PLUGIN, command, args).catch((err: unknown) =>
              console.warn(`[userActivity] ${command} failed:`, err),
          )
        : Promise.resolve();

/** Advertises the open note. Pass no `title` while notes are hidden outside the app. */
export async function setUserActivity(noteId: string, title?: string): Promise<void> {
    await call('user_activity_set', { noteId, title });
}

/** Stops advertising the note. Does nothing outside the macOS app. */
export async function clearUserActivity(): Promise<void> {
    await call('user_activity_clear');
}
