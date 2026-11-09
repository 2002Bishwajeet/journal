import { describe, expect, it } from 'vitest';
import { TOOLS } from '@/lib/agent/tools/registry';
import { npmReadme } from '../../mcp/npmReadme';

describe('npm README for journal-mcp (#1035)', () => {
    it('lists every tool the server registers and leaves no template markers', async () => {
        const readme = await npmReadme();
        for (const name of [...TOOLS.map((t) => t.name), 'run_script']) expect(readme).toContain(`| \`${name}\` |`);
        expect(readme).not.toContain('<!--');
        expect(readme.startsWith('![Journal MCP')).toBe(true);
    });

    it('points the banner at an absolute URL, so it renders on npm', async () => {
        expect(await npmReadme()).toContain('](https://raw.githubusercontent.com/2002Bishwajeet/journal/main/mcp/assets/banner.png)');
    });
});
