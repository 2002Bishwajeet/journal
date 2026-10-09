import { readFile, stat } from 'node:fs/promises';
import { assertImageByteSize, prepareImageBytes, type PreparedImage } from '@/lib/images/imageBytes';

const DATA_URI = /^data:[^,]*;base64,/i;

/**
 * An image an agent hands a tool (#516): a path to a file on this computer (cheap on
 * tokens) or a base64 `data:` URI (for agents whose files this server can't see).
 * Checked and stripped of metadata by prepareImageBytes.
 */
export async function loadImage(image: string): Promise<PreparedImage> {
    if (image.startsWith('data:')) {
        const match = DATA_URI.exec(image);
        if (!match) throw new Error('A data: URI image must be base64-encoded (data:image/png;base64,…)');
        return prepareImageBytes(new Uint8Array(Buffer.from(image.slice(match[0].length), 'base64')));
    }

    const info = await stat(image).catch(() => null);
    if (!info?.isFile()) throw new Error(`Image file not found: ${image}`);
    // Checked before reading, so a huge file is never loaded.
    assertImageByteSize(info.size);
    return prepareImageBytes(new Uint8Array(await readFile(image)));
}
