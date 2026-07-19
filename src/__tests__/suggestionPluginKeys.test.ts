// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { Editor } from '@tiptap/core';
import { createBaseExtensions } from '@/components/editor/plugins/extensions';
import { NoteLink } from '@/components/editor/nodes/NoteLinkNode';
import { NoteLinkExtension } from '@/components/editor/plugins/NoteLink';
import { SlashCommandsExtension } from '@/components/editor/plugins';

describe('suggestion plugin keys', () => {
    it('mounts an editor with slash commands AND note links without a key collision', () => {
        // Regression: both extensions used @tiptap/suggestion's default shared
        // PluginKey ('suggestion'), so ProseMirror threw "Adding different
        // instances of a keyed plugin (suggestion$)" on every editor mount.
        const element = document.createElement('div');
        const editor = new Editor({
            element,
            extensions: [
                ...createBaseExtensions(),
                SlashCommandsExtension,
                NoteLink,
                NoteLinkExtension,
            ],
        });
        const pluginKeys = editor.state.plugins.map((p) => (p as unknown as { key: string }).key);
        expect(pluginKeys.filter((k) => k.startsWith('slash-commands'))).toHaveLength(1);
        expect(pluginKeys.filter((k) => k.startsWith('note-link-suggestion'))).toHaveLength(1);
        editor.destroy();
    });
});
