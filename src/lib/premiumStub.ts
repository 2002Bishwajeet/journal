// `@premium` when the private native/ submodule isn't checked out (the public build,
// and the PWA). Keep its exports in step with native/web/index.ts.
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
