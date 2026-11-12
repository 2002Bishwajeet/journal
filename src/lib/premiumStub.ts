// `@premium` when the private native/ submodule isn't checked out (the public build,
// and the PWA). Keep its exports in step with native/web/index.ts.
import type { ReactNode } from 'react';

export const hasPremium = false;

export function listenTrayNewNote(onNewNote: () => void): Promise<() => void> {
    void onNewNote;
    return Promise.resolve(() => {});
}

export function getLaunchAtLogin(): Promise<boolean> {
    return Promise.resolve(false);
}

export function setLaunchAtLogin(on: boolean): Promise<void> {
    void on;
    return Promise.resolve();
}

export function quitApp(): Promise<void> {
    return Promise.resolve();
}

/** Desktop only: shows an OS notification. Resolves false when it could not be shown. */
export function notifyDesktop(title: string, body: string): Promise<boolean> {
    void title;
    void body;
    return Promise.resolve(false);
}

/** One-way copy of every note as a .md file into a folder the user picks (#1015). Desktop only. */
export interface NotesMirror {
    /** The folder the notes are mirrored into, or null while the mirror is off. */
    root(): Promise<string | null>;
    /** Asks for a folder and starts mirroring into it; null if the user cancels. */
    choose(identity: string): Promise<string | null>;
    /** Stops mirroring. The files stay where they are. */
    disable(): Promise<void>;
    openFolder(): Promise<void>;
    /** Starts the background mirror when it is on. Returns a function that stops it. */
    start(identity: string): () => void;
}

export const notesMirror: NotesMirror | null = null;

// License key, trial and paywall (#301): the public build has none.
export function LicenseGate(props: { onSignOut: () => void }): ReactNode {
    void props;
    return null;
}

export function TrialChip(): ReactNode {
    return null;
}

export function LicenseSection(props: { close: () => void }): ReactNode {
    void props;
    return null;
}

export function RenewForUpdate(props: { feature: string; children: ReactNode }): ReactNode {
    return props.children;
}

/** What the desktop quick-capture hotkey reports (native/rust/capture.rs). */
export interface QuickCaptureState {
    /** The accelerator the hotkey is set to, e.g. `CmdOrCtrl+Shift+J`. */
    shortcut: string;
    /** `XDG_SESSION_TYPE` on Linux ("wayland" has no global shortcuts), else an empty string. */
    session: string;
    /** Why the shortcut isn't registered right now (the OS refused it), if it isn't. */
    error: string | null;
}

/** The global hotkey and its capture window (#1014). Desktop only. */
export interface QuickCapture {
    state(): Promise<QuickCaptureState>;
    /** Registers a new accelerator and keeps it. Rejects with a message when the OS refuses it. */
    setShortcut(shortcut: string): Promise<QuickCaptureState>;
    /** Hides the capture window (Esc, or after a save). */
    hide(): Promise<void>;
}

export const quickCapture: QuickCapture | null = null;

/** What can unlock the native app (#1173): the App Store, Google Play or a license key. */
export type EntitlementSource = 'appStore' | 'play' | 'licenseKey';

export type EntitlementStatus = 'unlocked' | 'trial' | 'trial-not-started' | 'locked' | 'offline-expired';

/** Whether this app may be used to write, and why. The public build is always unlocked. */
export interface Entitlement {
    /** Undefined while the native app reads its sources (canEdit stays true meanwhile). */
    status: EntitlementStatus | undefined;
    /** True while unlocked or in the trial. */
    canEdit: boolean;
    unlockedBy?: EntitlementSource;
    trialEndsAt?: string;
    /** Set only when a license key unlocks: its year of updates ends here. */
    updatesUntil?: string;
    /** Reads every source again. */
    refresh(): Promise<void>;
}

const UNLOCKED: Entitlement = { status: 'unlocked', canEdit: true, refresh: () => Promise.resolve() };

export function useEntitlement(): Entitlement {
    return UNLOCKED;
}
