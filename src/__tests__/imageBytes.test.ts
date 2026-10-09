/**
 * Byte-level image checks for the MCP cover upload (#516): magic-byte detection, header
 * sizes and metadata stripping, on fixture images written with EXIF/GPS, XMP and text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
    MAX_IMAGE_BYTES,
    prepareImageBytes,
    readImageSize,
    sniffImageType,
    stripImageMetadata,
} from '@/lib/images/imageBytes';

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/images/${name}`, import.meta.url)));
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('latin1');

/** PNG chunk types in order. */
function pngChunkTypes(bytes: Uint8Array): string[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const types = [];
    for (let i = 8; i < bytes.length; i += 12 + view.getUint32(i)) types.push(text(bytes.subarray(i + 4, i + 8)));
    return types;
}

/** JPEG markers before the scan (SOS included). */
function jpegMarkers(bytes: Uint8Array): number[] {
    const markers = [];
    for (let i = 2; i < bytes.length; ) {
        const marker = bytes[i + 1];
        markers.push(marker);
        if (marker === 0xda) break;
        i += 2 + ((bytes[i + 2] << 8) | bytes[i + 3]);
    }
    return markers;
}

/** WebP chunk fourCCs in order. */
function webpChunkTypes(bytes: Uint8Array): string[] {
    const view = new DataView(bytes.buffer, bytes.byteOffset);
    const types = [];
    for (let i = 12; i < bytes.length; ) {
        const size = view.getUint32(i + 4, true);
        types.push(text(bytes.subarray(i, i + 4)));
        i += 8 + size + (size % 2);
    }
    return types;
}

describe('sniffImageType', () => {
    it('detects PNG, JPEG and WebP by their magic bytes', () => {
        expect(sniffImageType(fixture('cover-meta.png'))).toBe('image/png');
        expect(sniffImageType(fixture('cover-exif.jpg'))).toBe('image/jpeg');
        expect(sniffImageType(fixture('cover-exif.webp'))).toBe('image/webp');
        expect(sniffImageType(fixture('cover-lossless.webp'))).toBe('image/webp');
    });

    it('rejects anything else, whatever it is called', () => {
        expect(sniffImageType(new TextEncoder().encode('GIF89a\x01\x00\x01\x00'))).toBeNull();
        expect(sniffImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
        expect(sniffImageType(new TextEncoder().encode('RIFF\x00\x00\x00\x00WAVE'))).toBeNull();
        expect(sniffImageType(new Uint8Array())).toBeNull();
    });
});

describe('readImageSize', () => {
    it('reads the pixel size from each header', () => {
        expect(readImageSize(fixture('cover-meta.png'), 'image/png')).toEqual({ width: 40, height: 24 });
        expect(readImageSize(fixture('cover-exif.jpg'), 'image/jpeg')).toEqual({ width: 40, height: 24 });
        expect(readImageSize(fixture('cover-exif.webp'), 'image/webp')).toEqual({ width: 40, height: 24 }); // VP8X
        expect(readImageSize(fixture('cover-plain.webp'), 'image/webp')).toEqual({ width: 40, height: 24 }); // VP8
        expect(readImageSize(fixture('cover-lossless.webp'), 'image/webp')).toEqual({ width: 40, height: 24 }); // VP8L
    });
});

describe('stripImageMetadata', () => {
    it('drops the JPEG APP1 segments (EXIF with GPS, XMP) and keeps the scan data byte for byte', () => {
        const original = fixture('cover-exif.jpg');
        expect(jpegMarkers(original).filter((m) => m === 0xe1)).toHaveLength(2);
        expect(text(original)).toContain('SECRET-MODEL');

        const stripped = stripImageMetadata(original, 'image/jpeg');
        expect(jpegMarkers(stripped)).not.toContain(0xe1);
        expect(text(stripped)).not.toMatch(/Exif|SECRET|xmpmeta/);
        expect([...stripped.subarray(0, 2)]).toEqual([0xff, 0xd8]);
        const scan = (bytes: Uint8Array) => bytes.subarray(text(bytes).indexOf('\xff\xda'));
        expect(scan(stripped)).toEqual(scan(original));
        expect(readImageSize(stripped, 'image/jpeg')).toEqual({ width: 40, height: 24 });
    });

    it('drops the PNG eXIf, tEXt, iTXt and zTXt chunks and keeps the rest in order', () => {
        const original = fixture('cover-meta.png');
        expect(pngChunkTypes(original)).toEqual(expect.arrayContaining(['eXIf', 'tEXt', 'iTXt', 'zTXt']));

        const stripped = stripImageMetadata(original, 'image/png');
        expect(pngChunkTypes(stripped)).toEqual(
            pngChunkTypes(original).filter((t) => !['eXIf', 'tEXt', 'iTXt', 'zTXt'].includes(t))
        );
        expect(pngChunkTypes(stripped)[0]).toBe('IHDR');
        expect(pngChunkTypes(stripped).at(-1)).toBe('IEND');
        expect(text(stripped)).not.toMatch(/SECRET|Exif|MM\0\*/);
    });

    it('drops the WebP EXIF and XMP chunks, clears their VP8X flags and fixes the RIFF size', () => {
        const original = fixture('cover-exif.webp');
        expect(webpChunkTypes(original)).toEqual(['VP8X', 'VP8 ', 'EXIF', 'XMP ']);

        const stripped = stripImageMetadata(original, 'image/webp');
        expect(webpChunkTypes(stripped)).toEqual(['VP8X', 'VP8 ']);
        expect(stripped[20] & 0x0c).toBe(0);
        expect(new DataView(stripped.buffer).getUint32(4, true)).toBe(stripped.length - 8);
        expect(text(stripped)).not.toMatch(/SECRET|xmpmeta/);
        expect(readImageSize(stripped, 'image/webp')).toEqual({ width: 40, height: 24 });
    });

    it('leaves an image without metadata as it was', () => {
        const plain = fixture('cover-plain.webp');
        expect(stripImageMetadata(plain, 'image/webp')).toEqual(plain);
    });
});

describe('prepareImageBytes', () => {
    it('returns the stripped bytes, content type and size', () => {
        const prepared = prepareImageBytes(fixture('cover-exif.jpg'));
        expect(prepared).toMatchObject({ contentType: 'image/jpeg', width: 40, height: 24 });
        expect(jpegMarkers(prepared.bytes)).not.toContain(0xe1);
    });

    it('rejects an unsupported type, an image over 5 MB and a truncated image with a clear message', () => {
        expect(() => prepareImageBytes(new TextEncoder().encode('GIF89a'))).toThrow(
            'Unsupported image type: use a PNG, JPEG or WebP image'
        );
        const huge = new Uint8Array(MAX_IMAGE_BYTES + 1);
        huge.set(fixture('cover-meta.png'));
        expect(() => prepareImageBytes(huge)).toThrow('Image is too large (5.0 MB); the limit is 5 MB');
        expect(() => prepareImageBytes(fixture('cover-meta.png').subarray(0, 30))).toThrow('Not a valid PNG image');
        expect(() => prepareImageBytes(fixture('cover-exif.jpg').subarray(0, 40))).toThrow('Not a valid JPEG image');
    });
});
