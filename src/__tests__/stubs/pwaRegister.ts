/**
 * `virtual:pwa-register/react` only exists inside vite-plugin-pwa, so Vite's
 * import analysis cannot resolve it under vitest — and that failure happens
 * before vi.mock is consulted. vitest.config.ts aliases the specifier here so
 * the import resolves; tests that care about the behaviour still vi.mock it.
 */
export function useRegisterSW() {
    return {
        needRefresh: [false, () => { }],
        offlineReady: [false, () => { }],
        updateServiceWorker: async () => { },
    };
}
