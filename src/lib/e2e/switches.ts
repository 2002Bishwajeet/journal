/** E2E-only switches, set only through window.__journalE2E (./testHooks.ts). All off in normal use. */
export const e2eSwitches = {
    /** Skip incoming invites, so a shared note can arrive only through the shared pull (#732). */
    ignoreInvites: false,
};
