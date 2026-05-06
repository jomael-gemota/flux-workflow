import { deflateRawSync } from 'zlib';

/**
 * Minimal in-memory ZIP archive builder. Produces a single `Buffer` containing
 * a valid ZIP file from a small set of in-memory entries.
 *
 * Why custom and not `archiver`/`jszip`? The platform's policy is to avoid
 * adding production dependencies for one-off tasks. Each entry is at most a
 * few KB (extension source files + tiny PNG icons), so a self-contained ~120
 * line builder using only `zlib` is cheaper than a transitive npm dep.
 *
 * Format support: ZIP 2.0 with DEFLATE-compressed entries (`compression = 8`).
 * No ZIP64 extensions, no encryption, no archive comment. Sufficient for
 * archives well under 4 GB.
 *
 * @example
 *   const zip = buildZip([
 *       { path: 'manifest.json', data: Buffer.from(json) },
 *       { path: 'icons/icon-16.png', data: pngBuffer },
 *   ]);
 *   reply.send(zip); // a single Buffer
 */
export interface ZipEntry {
    /** POSIX-style relative path inside the archive (e.g. `icons/icon-16.png`). */
    path: string;
    /** Raw file contents. */
    data: Buffer;
}

const SIG_LFH  = 0x04034b50;
const SIG_CDH  = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** Reusable CRC-32 lookup table (IEEE polynomial, used by ZIP). */
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

/**
 * Encode the current local time as a (DOS time, DOS date) pair for ZIP headers.
 * The ZIP spec stores time at 2-second resolution and date with a 1980 epoch.
 */
function dosTimestamp(now: Date = new Date()): { time: number; date: number } {
    const time =
        ((now.getHours()   & 0x1f) << 11) |
        ((now.getMinutes() & 0x3f) << 5)  |
        ((Math.floor(now.getSeconds() / 2)) & 0x1f);
    const date =
        (((now.getFullYear() - 1980) & 0x7f) << 9) |
        (((now.getMonth() + 1)        & 0x0f) << 5) |
        (now.getDate()                & 0x1f);
    return { time, date };
}

export function buildZip(entries: ZipEntry[]): Buffer {
    const { time, date } = dosTimestamp();
    const localParts:    Buffer[] = [];
    const centralParts:  Buffer[] = [];
    let runningOffset = 0;

    for (const entry of entries) {
        const nameBuf    = Buffer.from(entry.path, 'utf8');
        const compressed = deflateRawSync(entry.data);
        const crc        = crc32(entry.data);

        // Local file header (30 bytes + name + extra(0) + data)
        const lfh = Buffer.alloc(30);
        lfh.writeUInt32LE(SIG_LFH,             0);
        lfh.writeUInt16LE(20,                  4); // version needed
        lfh.writeUInt16LE(0x0800,              6); // flags: bit 11 = UTF-8 names
        lfh.writeUInt16LE(8,                   8); // method: DEFLATE
        lfh.writeUInt16LE(time,                10);
        lfh.writeUInt16LE(date,                12);
        lfh.writeUInt32LE(crc,                 14);
        lfh.writeUInt32LE(compressed.length,   18);
        lfh.writeUInt32LE(entry.data.length,   22);
        lfh.writeUInt16LE(nameBuf.length,      26);
        lfh.writeUInt16LE(0,                   28); // extra length

        localParts.push(lfh, nameBuf, compressed);

        // Central directory header (46 bytes + name + extra(0) + comment(0))
        const cdh = Buffer.alloc(46);
        cdh.writeUInt32LE(SIG_CDH,             0);
        cdh.writeUInt16LE(0x031e,              4);  // version made by: 0x03=Unix, 0x1e=v3.0
        cdh.writeUInt16LE(20,                  6);  // version needed
        cdh.writeUInt16LE(0x0800,              8);  // flags
        cdh.writeUInt16LE(8,                   10); // method
        cdh.writeUInt16LE(time,                12);
        cdh.writeUInt16LE(date,                14);
        cdh.writeUInt32LE(crc,                 16);
        cdh.writeUInt32LE(compressed.length,   20);
        cdh.writeUInt32LE(entry.data.length,   24);
        cdh.writeUInt16LE(nameBuf.length,      28);
        cdh.writeUInt16LE(0,                   30); // extra length
        cdh.writeUInt16LE(0,                   32); // comment length
        cdh.writeUInt16LE(0,                   34); // disk number start
        cdh.writeUInt16LE(0,                   36); // internal attrs
        cdh.writeUInt32LE((0o100644 << 16) >>> 0, 38); // external attrs: regular file 0644
        cdh.writeUInt32LE(runningOffset,       42); // local header offset

        centralParts.push(cdh, nameBuf);

        runningOffset += lfh.length + nameBuf.length + compressed.length;
    }

    const centralDir   = Buffer.concat(centralParts);
    const centralStart = runningOffset;
    const centralSize  = centralDir.length;

    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(SIG_EOCD,            0);
    eocd.writeUInt16LE(0,                   4);  // disk number
    eocd.writeUInt16LE(0,                   6);  // disk with central dir
    eocd.writeUInt16LE(entries.length,      8);  // entries on this disk
    eocd.writeUInt16LE(entries.length,      10); // total entries
    eocd.writeUInt32LE(centralSize,         12);
    eocd.writeUInt32LE(centralStart,        16);
    eocd.writeUInt16LE(0,                   20); // comment length

    return Buffer.concat([...localParts, centralDir, eocd]);
}
