import { deflateSync } from 'node:zlib';

// A small PNG encoder for a solid-color image, generated here rather than a
// binary fixture file. 800x600 (a realistic photo size) rather than a 1x1 or
// 16x16 pixel test fixture: a degenerate source image made the server
// generate several identically-sized thumbnails, which 500'd a real upload.
const CRC_TABLE = (() => {
    const table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        table[n] = c;
    }
    return table;
})();

function crc32(buf: Buffer): number {
    let crc = -1;
    for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
    const typeBuf = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
    return Buffer.concat([len, typeBuf, data, crc]);
}

type Rgb = [number, number, number];

function encodePng(width: number, height: number, pixel: (x: number) => Rgb): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // color type: RGB

    const rowLen = 1 + width * 3; // leading filter byte (0) per scanline
    const raw = Buffer.alloc(rowLen * height);
    for (let y = 0; y < height; y++) {
        const rowStart = y * rowLen + 1;
        for (let x = 0; x < width; x++) {
            const rgb = pixel(x);
            raw[rowStart + x * 3] = rgb[0];
            raw[rowStart + x * 3 + 1] = rgb[1];
            raw[rowStart + x * 3 + 2] = rgb[2];
        }
    }

    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', deflateSync(raw)),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

export function makeSolidPng(width: number, height: number, rgb: Rgb): Buffer {
    return encodePng(width, height, () => rgb);
}

/**
 * A wide banner whose outer 10% columns on each side are `edge` and the rest `middle`,
 * standing in for a banner with text at both edges: a side crop loses the `edge` colour.
 */
export function makeBannerPng(width: number, height: number, edge: Rgb, middle: Rgb): Buffer {
    const band = Math.round(width * 0.1);
    return encodePng(width, height, (x) => (x < band || x >= width - band ? edge : middle));
}
