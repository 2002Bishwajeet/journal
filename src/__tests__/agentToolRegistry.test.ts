import { describe, it, expect } from 'vitest';
import { TOOLS, toJsonSchema } from '@/lib/agent/tools/registry';

describe('agent tool registry', () => {
    it('has unique tool names', () => {
        const names = TOOLS.map((tool) => tool.name);
        expect(new Set(names).size).toBe(names.length);
    });

    it('marks exactly the five read tools read-only', () => {
        const readOnly = TOOLS.filter((tool) => tool.readOnly).map((tool) => tool.name);
        expect(readOnly.sort()).toEqual(['get_authoring_guide', 'get_note', 'list_folders', 'list_notes', 'search_notes']);
    });

    it('converts every tool input to an object JSON Schema', () => {
        for (const tool of TOOLS) {
            expect(toJsonSchema(tool).type).toBe('object');
        }
    });

    it('exposes edit_block op as a union of the op variants', () => {
        const tool = TOOLS.find((t) => t.name === 'edit_block')!;
        const op = (toJsonSchema(tool).properties as Record<string, { anyOf?: unknown[]; oneOf?: unknown[] }>).op;
        expect((op.anyOf ?? op.oneOf)?.length).toBeGreaterThan(1);
    });
});
