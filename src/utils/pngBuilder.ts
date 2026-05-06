import { deflateSync } from 'zlib';

/**
 * Tiny solid-colour PNG builder. Produces a valid 8-bit RGB PNG of the given
 * size filled with a single colour. Used to generate browser-extension
 * icon files at server start without shipping binary blobs in the repo or
 * pulling in image libraries (sharp, pngjs, canvas, etc.).
 *
 * PNG anatomy produced here:
 *   ┌─ 8-byte signature
 *   ├─ IHDR chunk  (width, height, bit-depth=8, colour-type=2 RGB)
 *   ├─ IDAT chunk  (zlib-deflated scanlines, filter byte 0 per row)
 *   └─ IEND chunk  (terminator)
 *
 * Solid-colour scanlines compress to a couple of bytes regardless of size,
 * so even the 128×128 icon is well under 1 KB.
 *
 * @example
 *   const png = makeSolidPng(48, 21, 75, 47); // Basecamp green
 */

/** Reusable CRC-32 table (IEEE polynomial, identical to ZIP's). */
const CRC_TABLE: number[] = (() => {
    const t = new Array<number>(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(buf: Buffer): number {
    let c = 0xffffffff;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
    const len   = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const tBuf  = Buffer.from(type, 'ascii');
    const crc   = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([tBuf, data])), 0);
    return Buffer.concat([len, tBuf, data, crc]);
}

export function makeSolidPng(size: number, r: number, g: number, b: number): Buffer {
    if (size <= 0 || size > 4096) throw new Error('makeSolidPng: size out of range');

    // One row of raw pixel data: a leading filter byte (0 = None) followed by
    // size × RGB triplets. Replicate it `size` times to form the full bitmap.
    const row = Buffer.alloc(1 + size * 3);
    for (let i = 0; i < size; i++) {
        row[1 + i * 3]     = r;
        row[1 + i * 3 + 1] = g;
        row[1 + i * 3 + 2] = b;
    }
    const raw = Buffer.alloc(row.length * size);
    for (let y = 0; y < size; y++) row.copy(raw, y * row.length);
    const compressed = deflateSync(raw);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(size, 0);
    ihdr.writeUInt32BE(size, 4);
    ihdr[8]  = 8;   // bit depth
    ihdr[9]  = 2;   // colour type: RGB
    ihdr[10] = 0;   // compression method: deflate
    ihdr[11] = 0;   // filter method: standard
    ihdr[12] = 0;   // interlace: none

    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    return Buffer.concat([
        sig,
        chunk('IHDR', ihdr),
        chunk('IDAT', compressed),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}
