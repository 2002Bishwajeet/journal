import type { AgentEvent } from '@/lib/agent/loop/agentLoop';

/** E2E-only switches, set only through window.__journalE2E (./testHooks.ts). All off in normal use. */
export const e2eSwitches = {
    /** Skip incoming invites, so a shared note can arrive only through the shared pull (#732). */
    ignoreInvites: false,
    /** Gets every event of the assistant's runs, for the AI eval (#706). */
    onAgentEvent: undefined as ((event: AgentEvent) => void) | undefined,
};
