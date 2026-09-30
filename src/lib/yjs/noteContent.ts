import * as Y from 'yjs';

/**
 * Build the new note's initial block structure from a content string. A
 * ProseMirror text node cannot hold newlines or render markdown syntax — a
 * single-paragraph dump shows "# Title\n\n" as literal text — so split into
 * one block per line, with `# `–`###### ` lines becoming headings. That is
 * the only markdown the in-app content strings use; everything else stays a
 * plain paragraph.
 */
export function pushContentBlocks(fragment: Y.XmlFragment, content: string): void {
    const blocks: Y.XmlElement[] = [];
    for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        const heading = line.match(/^(#{1,6}) (.*)$/);
        const el = new Y.XmlElement(heading ? 'heading' : 'paragraph');
        // Level must be a number — TipTap's heading falls back to h1 otherwise
        if (heading) el.setAttribute('level', heading[1].length as unknown as string);
        const text = heading ? heading[2] : line;
        if (text) el.push([new Y.XmlText(text)]);
        blocks.push(el);
    }
    // The editor expects at least one block to place the cursor in, and a
    // trailing heading needs an empty paragraph after it so typing starts as
    // body text instead of extending the heading.
    if (blocks.length === 0 || blocks[blocks.length - 1].nodeName === 'heading') {
        blocks.push(new Y.XmlElement('paragraph'));
    }
    fragment.push(blocks);
}

// The single definition of the template placeholder token — body substitution
// here and title substitution in useTemplates both consume it.
export const DATE_TOKEN = '{{date}}';

/**
 * Replace {{date}} in one text run, preserving each run's marks. A token
 * split across two differently-formatted runs is left alone — the token is
 * always typed in one style.
 */
function replaceDateTokens(text: Y.XmlText, dateString: string): void {
    for (;;) {
        const delta = text.toDelta() as Array<{ insert?: unknown; attributes?: Record<string, unknown> }>;
        let pos = 0;
        let found = -1;
        let attrs: Record<string, unknown> | undefined;
        for (const op of delta) {
            if (typeof op.insert !== 'string') {
                pos += 1; // embeds count as length 1
                continue;
            }
            const idx = op.insert.indexOf(DATE_TOKEN);
            if (idx !== -1) {
                found = pos + idx;
                attrs = op.attributes;
                break;
            }
            pos += op.insert.length;
        }
        if (found === -1) return;
        text.delete(found, DATE_TOKEN.length);
        text.insert(found, dateString, attrs);
    }
}

export function substituteDateTokens(node: Y.XmlFragment, dateString: string): void {
    node.toArray().forEach((child) => {
        if (child instanceof Y.XmlText) replaceDateTokens(child, dateString);
        else if (child instanceof Y.XmlElement) substituteDateTokens(child, dateString);
    });
}
