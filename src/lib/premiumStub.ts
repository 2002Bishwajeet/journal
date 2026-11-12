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
