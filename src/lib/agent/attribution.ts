/**
 * Agent-access attribution (#170): recognizes `lastEditedBy = 'agent:<mcp client name>'`
 * (written by #169's write tools) and maps it to a display name for the note UI. Pure
 * logic, no imports — shared by every place `lastEditedBy` is rendered.
 */

const KNOWN_AGENTS: Record<string, string> = {
    'claude-code': 'Claude Code',
    'claude-ai': 'Claude',
    codex: 'Codex',
    'codex-mcp-client': 'Codex',
    agent: 'An agent',
};

/** True when `lastEditedBy` is an agent's `agent:<name>` (#169), never a human OdinId. */
export function isAgentEditor(lastEditedBy?: string): boolean {
    return lastEditedBy?.startsWith('agent:') === true;
}

/** `agent:<client name>`, lower-cased, non [a-z0-9-] chars -> '-', max 40 chars; never collides with an OdinId. */
export function agentEditor(clientName: string): string {
    const name = clientName.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40);
    return `agent:${name || 'agent'}`;
}

/** Display name for an agent-authored `lastEditedBy`, or null when it's a human editor. */
export function agentDisplayName(lastEditedBy?: string): string | null {
    if (!lastEditedBy || !isAgentEditor(lastEditedBy)) return null;

    const name = lastEditedBy.slice('agent:'.length);
    if (name in KNOWN_AGENTS) return KNOWN_AGENTS[name];

    return name
        .split(/[-_]/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
