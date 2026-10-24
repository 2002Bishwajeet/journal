/**
 * What the editor's AI slash commands ask the rest of the app to do (#703): `ask` and
 * `summarize` go to the assistant panel, `rewrite` opens the AI menu for the selection.
 */
export type AIRequest = 'ask' | 'summarize' | 'rewrite';

const listeners = new Set<(request: AIRequest) => void>();

export const aiRequests = {
    emit: (request: AIRequest) => listeners.forEach((listener) => listener(request)),
    subscribe(listener: (request: AIRequest) => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
    },
};
