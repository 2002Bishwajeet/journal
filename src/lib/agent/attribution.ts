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

/** Display name for an agent-authored `lastEditedBy`, or null when it's a human editor. */
export function agentDisplayName(lastEditedBy?: string): string | null {
    if (!isAgentEditor(lastEditedBy)) return null;

    const name = lastEditedBy!.slice('agent:'.length);
    if (name in KNOWN_AGENTS) return KNOWN_AGENTS[name];

    return name
        .split(/[-_]/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
