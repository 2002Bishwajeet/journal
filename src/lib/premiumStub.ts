// `@premium` when the private native/ submodule isn't checked out (the public build,
// and the PWA). Keep its exports in step with native/web/index.ts.
export const hasPremium = false;

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
