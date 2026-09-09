// minimal STORE-only ZIP builder

const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[n] = c >>> 0;
    }
    return table;
})();

function crc32(bytes) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < bytes.length; i++) {
        crc = CRC_TABLE[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

function dosDateTime(date) {
    const dosTime = ((date.getHours() & 0x1F) << 11) | ((date.getMinutes() & 0x3F) << 5) | ((date.getSeconds() >> 1) & 0x1F);
    const dosDate = (((date.getFullYear() - 1980) & 0x7F) << 9) | (((date.getMonth() + 1) & 0xF) << 5) | (date.getDate() & 0x1F);
    return { dosTime, dosDate };
}

function u16(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF]); }
function u32(n) { return new Uint8Array([n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]); }

/**
 * @param {Array<{name: string, data: Uint8Array}>} files
 * @returns {Blob} application/zip blob
 */
export function buildZip(files) {
    const { dosTime, dosDate } = dosDateTime(new Date());
    const localParts = [];
    const centralParts = [];
    let offset = 0;

    for (const { name, data } of files) {
        const nameBytes = new TextEncoder().encode(name);
        const crc = crc32(data);
        const size = data.length;

        const localHeader = new Uint8Array([
            ...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0),
            ...u16(dosTime), ...u16(dosDate),
            ...u32(crc), ...u32(size), ...u32(size),
            ...u16(nameBytes.length), ...u16(0),
        ]);

        localParts.push(localHeader, nameBytes, data);

        const centralHeader = new Uint8Array([
            ...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0),
            ...u16(dosTime), ...u16(dosDate),
            ...u32(crc), ...u32(size), ...u32(size),
            ...u16(nameBytes.length), ...u16(0), ...u16(0),
            ...u16(0), ...u16(0), ...u32(0),
            ...u32(offset),
        ]);
        centralParts.push(centralHeader, nameBytes);

        offset += localHeader.length + nameBytes.length + size;
    }

    const centralSize = centralParts.reduce((sum, p) => sum + p.length, 0);
    const centralOffset = offset;

    const eocd = new Uint8Array([
        ...u32(0x06054b50), ...u16(0), ...u16(0),
        ...u16(files.length), ...u16(files.length),
        ...u32(centralSize), ...u32(centralOffset), ...u16(0),
    ]);

    return new Blob([...localParts, ...centralParts, eocd], { type: 'application/zip' });
}