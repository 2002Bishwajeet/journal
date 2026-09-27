import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { collectImageRefs } from '@/lib/yjs/imageRefs';

function image(src: string): Y.XmlElement {
    const el = new Y.XmlElement('image');
    el.setAttribute('src', src);
    return el;
}

describe('collectImageRefs', () => {
    it('returns the fileId and payloadKey of every attachment image, including nested ones', () => {
        const doc = new Y.Doc();
        const fragment = doc.getXmlFragment('prosemirror');
        const listItem = new Y.XmlElement('listItem');
        const list = new Y.XmlElement('bulletList');
        fragment.insert(0, [image('attachment://file-A/jrnl_img0'), list]);
        list.insert(0, [listItem]);
        listItem.insert(0, [image('attachment://file-B/jrnl_img3')]);

        expect(collectImageRefs(fragment)).toEqual([
            { fileId: 'file-A', payloadKey: 'jrnl_img0' },
            { fileId: 'file-B', payloadKey: 'jrnl_img3' },
        ]);
        doc.destroy();
    });

    it('ignores images whose src is not an attachment:// reference', () => {
        const doc = new Y.Doc();
        const fragment = doc.getXmlFragment('prosemirror');
        fragment.insert(0, [
            image('blob:https://dev.dotyou.cloud/1234'),
            image('https://example.com/cat.png'),
            image('attachment://file-A/jrnl_img1'),
        ]);

        expect(collectImageRefs(fragment)).toEqual([{ fileId: 'file-A', payloadKey: 'jrnl_img1' }]);
        doc.destroy();
    });
});
