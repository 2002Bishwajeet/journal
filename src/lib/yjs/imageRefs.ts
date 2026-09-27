import * as Y from 'yjs';

/**
 * Collect every `attachment://<fileId>/<payloadKey>` image in a prosemirror fragment.
 * The fileId matters: a copy/pasted image keeps the src of the note it came from.
 */
export function collectImageRefs(fragment: Y.XmlFragment): Array<{ fileId: string; payloadKey: string }> {
    const refs: Array<{ fileId: string; payloadKey: string }> = [];

    const walkNode = (node: Y.XmlElement | Y.XmlFragment) => {
        if (node instanceof Y.XmlElement && node.nodeName === 'image') {
            const src = node.getAttribute('src');
            if (typeof src === 'string' && src.startsWith('attachment://')) {
                const parts = src.replace('attachment://', '').split('/');
                if (parts.length >= 2) {
                    refs.push({ fileId: parts[0], payloadKey: parts[1] });
                }
            }
        }
        for (let i = 0; i < node.length; i++) {
            const child = node.get(i);
            if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) {
                walkNode(child);
            }
        }
    };

    walkNode(fragment);
    return refs;
}
