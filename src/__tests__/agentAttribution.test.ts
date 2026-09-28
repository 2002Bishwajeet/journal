import { describe, it, expect } from 'vitest';
import { isAgentEditor, agentDisplayName } from '@/lib/agent/attribution';

describe('isAgentEditor', () => {
    it('true for an agent: lastEditedBy', () => {
        expect(isAgentEditor('agent:x')).toBe(true);
    });

    it('false for an OdinId lastEditedBy', () => {
        expect(isAgentEditor('a.b')).toBe(false);
    });

    it('false for undefined', () => {
        expect(isAgentEditor(undefined)).toBe(false);
    });
});

describe('agentDisplayName', () => {
    it('maps agent:claude-code to Claude Code', () => {
        expect(agentDisplayName('agent:claude-code')).toBe('Claude Code');
    });

    it('maps agent:claude-ai to Claude', () => {
        expect(agentDisplayName('agent:claude-ai')).toBe('Claude');
    });

    it('maps agent:codex to Codex', () => {
        expect(agentDisplayName('agent:codex')).toBe('Codex');
    });

    it('maps agent:codex-mcp-client to Codex', () => {
        expect(agentDisplayName('agent:codex-mcp-client')).toBe('Codex');
    });

    it('maps agent:agent to An agent', () => {
        expect(agentDisplayName('agent:agent')).toBe('An agent');
    });

    it('title-cases an unknown agent name, - and _ to spaces', () => {
        expect(agentDisplayName('agent:my-bot')).toBe('My Bot');
        expect(agentDisplayName('agent:my_bot')).toBe('My Bot');
    });

    it('null for a human OdinId', () => {
        expect(agentDisplayName('frodo.dotyou.cloud')).toBe(null);
    });

    it('null for undefined', () => {
        expect(agentDisplayName(undefined)).toBe(null);
    });
});
