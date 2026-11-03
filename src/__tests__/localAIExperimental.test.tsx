/**
 * The on-device assistant is labelled Experimental and points to MCP agents (#936),
 * in Settings → AI on every screen size.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_SETTINGS } from '@/hooks/useAISettings';

const prefs = { isSupported: true };
vi.mock('@/hooks/useAIPreferences', () => ({
    useAIPreferences: () => ({
        settings: DEFAULT_SETTINGS,
        isReady: false,
        isLoading: false,
        loadingProgress: 0,
        loadingMessage: '',
        error: null,
        isSupported: prefs.isSupported,
        downloadDialogProps: { pending: null, onContinue: () => {}, onCancel: () => {} },
    }),
}));

const { default: AISection } = await import('@/components/settings/sections/AISection');
const { AGENTS_URL } = await import('@/components/LocalAIExperimental');

describe('Local AI experimental notice', () => {
    beforeEach(() => {
        prefs.isSupported = true;
    });

    it.each([true, false])('Settings shows the badge, the copy and the agents link (supported: %s)', (isSupported) => {
        prefs.isSupported = isSupported;
        const html = renderToStaticMarkup(<AISection />);
        expect(html).toContain('>Experimental</span>');
        expect(html).toContain('Runs entirely on this device. Slower and less capable than AI agents connected through MCP.');
        expect(html).toContain(`href="${AGENTS_URL}"`);
        expect(html).toContain('>Set up an agent</a>');
    });

    it('links to the agents page in a new tab', () => {
        expect(AGENTS_URL).toBe('https://journal.cloudx.run/agents');
        const html = renderToStaticMarkup(<AISection />);
        expect(html).toMatch(/<a href="https:\/\/journal\.cloudx\.run\/agents" target="_blank" rel="noopener noreferrer"/);
    });
});
