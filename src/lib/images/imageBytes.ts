/**
 * Byte-level image checks for places with no canvas (the MCP server runs in Node, #516):
 * detect the type by magic bytes, read the pixel size from the header, and strip
 * metadata without re-encoding. The browser path is imageIngest.ts, which re-encodes.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface PreparedImage {
    bytes: Uint8Array;
    contentType: ImageType;
    width: number;
    height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_METADATA_CHUNKS = new Set(['eXIf', 'tEXt', 'iTXt', 'zTXt']);
const WEBP_METADATA_CHUNKS = new Set(['EXIF', 'XMP ']);
// VP8X flag bits that announce an EXIF or XMP chunk.
const VP8X_EXIF_XMP_FLAGS = 0x08 | 0x04;

const ascii = (bytes: Uint8Array, start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32le = (b: Uint8Array, i: number) => (u24le(b, i) | (b[i + 3] << 24)) >>> 0;

function invalid(type: ImageType): Error {
    return new Error(`Not a valid ${type.slice('image/'.length).toUpperCase()} image`);
}

export function sniffImageType(bytes: Uint8Array): ImageType | null {
    if (PNG_SIGNATURE.every((b, i) => bytes[i] === b)) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
    if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'image/webp';
    return null;
}

/** PNG chunks as [start, end) byte ranges (length + type + data + CRC), after the signature. */
function pngChunks(bytes: Uint8Array): { type: string; start: number; end: number }[] {
    const chunks = [];
    let i = PNG_SIGNATURE.length;
    while (i < bytes.length) {
        if (i + 12 > bytes.length) throw invalid('image/png');
        const end = i + 12 + u32be(bytes, i);
        if (end > bytes.length) throw invalid('image/png');
        chunks.push({ type: ascii(bytes, i + 4, 4), start: i, end });
        i = end;
    }
    return chunks;
}

/** JPEG marker segments before the scan data as [start, end) ranges, and where the scan starts. */
function jpegSegments(bytes: Uint8Array): { segments: { marker: number; start: number; end: number }[]; scanStart: number } {
    const segments = [];
    let i = 2; // after SOI
    while (i + 4 <= bytes.length) {
        if (bytes[i] !== 0xff) throw invalid('image/jpeg');
        const marker = bytes[i + 1];
        if (marker === 0xff) {
            i++; // fill byte
            continue;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            i += 2; // TEM and RSTn have no length
            continue;
        }
        const end = i + 2 + u16be(bytes, i + 2);
        if (end > bytes.length) throw invalid('image/jpeg');
        // SOS: everything from here on is entropy-coded data, copied as is.
        if (marker === 0xda) return { segments, scanStart: i };
        segments.push({ marker, start: i, end });
        i = end;
    }
    throw invalid('image/jpeg');
}

/** WebP chunks after the 12-byte RIFF header as [start, end) ranges, padding included. */
function webpChunks(bytes: Uint8Array): { type: string; start: number; end: number }[] {
    const chunks = [];
    let i = 12;
    while (i < bytes.length) {
        if (i + 8 > bytes.length) throw invalid('image/webp');
        const size = u32le(bytes, i + 4);
        const end = i + 8 + size + (size % 2);
        if (end > bytes.length) throw invalid('image/webp');
        chunks.push({ type: ascii(bytes, i, 4), start: i, end });
        i = end;
    }
    return chunks;
}

function concat(parts: Uint8Array[]): Uint8Array {
    const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
    let offset = 0;
    for (const part of parts) {
        out.set(part, offset);
        offset += part.length;
    }
    return out;
}

/**
 * The image without its metadata: JPEG APP1 segments (EXIF, XMP), PNG eXIf/tEXt/iTXt/zTXt
 * chunks, WebP EXIF/XMP chunks. The pixels are untouched. Note that EXIF orientation goes
 * with the EXIF, so a rotated phone JPEG shows as stored.
 */
export function stripImageMetadata(bytes: Uint8Array, type: ImageType): Uint8Array {
    if (type === 'image/png') {
        const kept = pngChunks(bytes).filter((c) => !PNG_METADATA_CHUNKS.has(c.type));
        return concat([bytes.subarray(0, PNG_SIGNATURE.length), ...kept.map((c) => bytes.subarray(c.start, c.end))]);
    }
    if (type === 'image/jpeg') {
        const { segments, scanStart } = jpegSegments(bytes);
        const kept = segments.filter((s) => s.marker !== 0xe1);
        return concat([bytes.subarray(0, 2), ...kept.map((s) => bytes.subarray(s.start, s.end)), bytes.subarray(scanStart)]);
    }
    const kept = webpChunks(bytes)
        .filter((c) => !WEBP_METADATA_CHUNKS.has(c.type))
        .map((c) => {
            const chunk = bytes.slice(c.start, c.end);
            if (c.type === 'VP8X') chunk[8] &= ~VP8X_EXIF_XMP_FLAGS;
            return chunk;
        });
    const out = concat([bytes.subarray(0, 12), ...kept]);
    new DataView(out.buffer).setUint32(4, out.length - 8, true);
    return out;
}

/** The pixel size from the image header, or null when the header has none. */
export function readImageSize(bytes: Uint8Array, type: ImageType): { width: number; height: number } | null {
    if (type === 'image/png') {
        const ihdr = pngChunks(bytes)[0];
        return ihdr?.type === 'IHDR' && ihdr.end - ihdr.start >= 20
            ? { width: u32be(bytes, ihdr.start + 8), height: u32be(bytes, ihdr.start + 12) }
            : null;
    }
    if (type === 'image/jpeg') {
        // SOF0–SOF15, except DHT (C4), JPG (C8) and DAC (CC).
        const sof = jpegSegments(bytes).segments.find(
            (s) => s.marker >= 0xc0 && s.marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(s.marker)
        );
        return sof && sof.end - sof.start >= 9
            ? { width: u16be(bytes, sof.start + 7), height: u16be(bytes, sof.start + 5) }
            : null;
    }
    for (const chunk of webpChunks(bytes)) {
        const d = chunk.start + 8;
        if (chunk.type === 'VP8X' && chunk.end - d >= 10) {
            return { width: u24le(bytes, d + 4) + 1, height: u24le(bytes, d + 7) + 1 };
        }
        if (chunk.type === 'VP8L' && chunk.end - d >= 5 && bytes[d] === 0x2f) {
            const bits = u32le(bytes, d + 1);
            return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
        }
        if (chunk.type === 'VP8 ' && chunk.end - d >= 10 && bytes[d + 3] === 0x9d && bytes[d + 4] === 0x01 && bytes[d + 5] === 0x2a) {
            return { width: (bytes[d + 6] | (bytes[d + 7] << 8)) & 0x3fff, height: (bytes[d + 8] | (bytes[d + 9] << 8)) & 0x3fff };
        }
    }
    return null;
}

export function assertImageByteSize(byteLength: number): void {
    if (byteLength > MAX_IMAGE_BYTES) {
        throw new Error(`Image is too large (${(byteLength / 1024 / 1024).toFixed(1)} MB); the limit is 5 MB`);
    }
}

/**
 * Checks an image for upload and strips its metadata. Throws a message an agent can act
 * on for anything that isn't a PNG, JPEG or WebP of at most 5 MB.
 */
export function prepareImageBytes(bytes: Uint8Array): PreparedImage {
    assertImageByteSize(bytes.length);
    const contentType = sniffImageType(bytes);
    if (!contentType) throw new Error('Unsupported image type: use a PNG, JPEG or WebP image');
    const stripped = stripImageMetadata(bytes, contentType);
    const size = readImageSize(stripped, contentType);
    if (!size || size.width === 0 || size.height === 0) throw invalid(contentType);
    return { bytes: stripped, contentType, ...size };
}
