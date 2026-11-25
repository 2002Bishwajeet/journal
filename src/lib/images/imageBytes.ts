/**
 * Byte-level image checks for places with no canvas (the MCP server runs in Node, #516):
 * detect the type by magic bytes, read the pixel size from the header, and strip
 * metadata without re-encoding. The browser path is imageIngest.ts, which re-encodes.
 */

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Larger than any photo: past these a small file can still decode to gigabytes of pixels. */
const MAX_SIDE = 16384;
const MAX_PIXELS = 100_000_000;

export type ImageType = 'image/png' | 'image/jpeg' | 'image/webp';

export interface PreparedImage {
    bytes: Uint8Array;
    contentType: ImageType;
    width: number;
    height: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// What is kept: the chunks and segments that draw the image. Everything else (EXIF, XMP, text, comments,
// IPTC, private chunks, trailing bytes) is metadata or a hiding place for it.
const PNG_KEPT = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'pHYs', 'bKGD', 'acTL', 'fcTL', 'fdAT']);
const WEBP_KEPT = new Set(['VP8 ', 'VP8L', 'VP8X', 'ALPH', 'ICCP', 'ANIM', 'ANMF']);
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

/** PNG chunks as [start, end) byte ranges (length + type + data + CRC), after the signature, up to IEND. */
function pngChunks(bytes: Uint8Array): { type: string; start: number; end: number }[] {
    const chunks = [];
    let i = PNG_SIGNATURE.length;
    while (i < bytes.length) {
        if (i + 12 > bytes.length) throw invalid('image/png');
        const end = i + 12 + u32be(bytes, i);
        if (end > bytes.length) throw invalid('image/png');
        const type = ascii(bytes, i + 4, 4);
        chunks.push({ type, start: i, end });
        if (type === 'IEND') break;
        i = end;
    }
    return chunks;
}

const isSof = (marker: number) => marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);

/**
 * JPEG segments after SOI as [start, end) ranges, up to EOI. A scan (SOS) runs on through its
 * entropy-coded data, to the next marker that isn't a stuffed 0xFF00 or an RSTn.
 */
function jpegSegments(bytes: Uint8Array): { marker: number; start: number; end: number }[] {
    const segments = [];
    let i = 2; // after SOI
    while (i + 1 < bytes.length) {
        if (bytes[i] !== 0xff) throw invalid('image/jpeg');
        const marker = bytes[i + 1];
        if (marker === 0xff) {
            i++; // fill byte
            continue;
        }
        if (marker === 0xd9) {
            segments.push({ marker, start: i, end: i + 2 });
            break;
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            i += 2; // TEM and RSTn have no length
            continue;
        }
        if (i + 4 > bytes.length) throw invalid('image/jpeg');
        let end = i + 2 + u16be(bytes, i + 2);
        if (end > bytes.length) throw invalid('image/jpeg');
        if (marker === 0xda) {
            while (end < bytes.length && !(bytes[end] === 0xff && bytes[end + 1] !== 0 && !(bytes[end + 1] >= 0xd0 && bytes[end + 1] <= 0xd7))) end++;
        }
        segments.push({ marker, start: i, end });
        i = end;
    }
    if (!segments.some((s) => s.marker === 0xda)) throw invalid('image/jpeg');
    return segments;
}

/** Kept: APP0 (JFIF), APP2 only as an ICC profile, APP14 (Adobe), DQT, DHT, DAC, SOFn, DRI, SOS with its scan, EOI. */
function keptJpegSegment(bytes: Uint8Array, { marker, start }: { marker: number; start: number }): boolean {
    if (marker === 0xe2) return ascii(bytes, start + 4, 12) === 'ICC_PROFILE\0';
    return [0xe0, 0xee, 0xdb, 0xc4, 0xcc, 0xdd, 0xda, 0xd9].includes(marker) || isSof(marker);
}

/** WebP chunks after the 12-byte RIFF header as [start, end) ranges, padding included, within the RIFF size. */
function webpChunks(bytes: Uint8Array): { type: string; start: number; end: number }[] {
    const chunks = [];
    const length = Math.min(bytes.length, 8 + u32le(bytes, 4));
    let i = 12;
    while (i < length) {
        if (i + 8 > length) throw invalid('image/webp');
        const size = u32le(bytes, i + 4);
        const end = i + 8 + size + (size % 2);
        if (end > length) throw invalid('image/webp');
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
 * The image with only what draws it: the PNG_KEPT chunks, the keptJpegSegment segments, the WEBP_KEPT
 * chunks, and nothing after the end of the image. The pixels are untouched. Note that EXIF orientation
 * goes with the EXIF, so a rotated phone JPEG shows as stored.
 */
export function stripImageMetadata(bytes: Uint8Array, type: ImageType): Uint8Array {
    if (type === 'image/png') {
        const kept = pngChunks(bytes).filter((c) => PNG_KEPT.has(c.type));
        return concat([bytes.subarray(0, PNG_SIGNATURE.length), ...kept.map((c) => bytes.subarray(c.start, c.end))]);
    }
    if (type === 'image/jpeg') {
        const kept = jpegSegments(bytes).filter((s) => keptJpegSegment(bytes, s));
        return concat([bytes.subarray(0, 2), ...kept.map((s) => bytes.subarray(s.start, s.end))]);
    }
    const kept = webpChunks(bytes)
        .filter((c) => WEBP_KEPT.has(c.type))
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
        const sof = jpegSegments(bytes).find((s) => isSof(s.marker));
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
 * on for anything that isn't a PNG, JPEG or WebP of at most 5 MB, 16384 px a side and 100 MP.
 */
export function prepareImageBytes(bytes: Uint8Array): PreparedImage {
    assertImageByteSize(bytes.length);
    const contentType = sniffImageType(bytes);
    if (!contentType) throw new Error('Unsupported image type: use a PNG, JPEG or WebP image');
    const stripped = stripImageMetadata(bytes, contentType);
    const size = readImageSize(stripped, contentType);
    if (!size || size.width === 0 || size.height === 0) throw invalid(contentType);
    if (Math.max(size.width, size.height) > MAX_SIDE || size.width * size.height > MAX_PIXELS) {
        throw new Error(`Image is too large (${size.width} × ${size.height} px); the limit is ${MAX_SIDE} px a side and 100 megapixels`);
    }
    return { bytes: stripped, contentType, ...size };
}
