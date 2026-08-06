/* ReqPub v2 - STORE-only zip writer. Zero dependencies, zero compression,
   deterministic bytes: the same files and the same baseline date always
   produce the identical archive. Built for the implementation package - a
   handful of small text files - where DEFLATE buys nothing and a third-party
   zip library would be the first runtime dependency this frontend ever took.
   Format: local file headers + central directory + end-of-central-directory,
   method 0 (stored), per the PKWARE APPNOTE. Nothing here is clever; that is
   the point. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/* DOS date/time from a Date, read in UTC so the archive does not depend on
   the machine that produced it. The zip epoch is 1980. */
const dosStamp = (d) => {
  const y = Math.max(d.getUTCFullYear(), 1980);
  const date = ((y - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate();
  const time = (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1);
  return { date, time };
};

/* files: [{ name, data: string | Uint8Array }] · when: Date | ISO string.
   Returns Uint8Array. Names must be unique, non-empty, and use forward
   slashes; strings are encoded UTF-8. */
export function zipStore(files, when) {
  const enc = new TextEncoder();
  const stamp = dosStamp(when instanceof Date ? when : new Date(when || 0));
  const seen = new Set();
  const entries = (files || []).map((f) => {
    const name = String(f.name || '');
    if (!name || seen.has(name)) throw new Error('zipStore: duplicate or empty name: ' + name);
    seen.add(name);
    const data = typeof f.data === 'string' ? enc.encode(f.data) : (f.data || new Uint8Array(0));
    return { nameBytes: enc.encode(name), data, crc: crc32(data) };
  });

  const localSize = entries.reduce((t, e) => t + 30 + e.nameBytes.length + e.data.length, 0);
  const centralSize = entries.reduce((t, e) => t + 46 + e.nameBytes.length, 0);
  const out = new Uint8Array(localSize + centralSize + 22);
  const dv = new DataView(out.buffer);
  let p = 0;
  const u16 = (v) => { dv.setUint16(p, v, true); p += 2; };
  const u32 = (v) => { dv.setUint32(p, v >>> 0, true); p += 4; };
  const put = (b) => { out.set(b, p); p += b.length; };

  entries.forEach((e) => {
    e.offset = p;
    u32(0x04034B50); u16(20); u16(0x0800 /* UTF-8 names */); u16(0 /* STORE */);
    u16(stamp.time); u16(stamp.date); u32(e.crc); u32(e.data.length); u32(e.data.length);
    u16(e.nameBytes.length); u16(0);
    put(e.nameBytes); put(e.data);
  });
  const cdStart = p;
  entries.forEach((e) => {
    u32(0x02014B50); u16(20); u16(20); u16(0x0800); u16(0);
    u16(stamp.time); u16(stamp.date); u32(e.crc); u32(e.data.length); u32(e.data.length);
    u16(e.nameBytes.length); u16(0); u16(0); u16(0); u16(0); u32(0); u32(e.offset);
    put(e.nameBytes);
  });
  u32(0x06054B50); u16(0); u16(0); u16(entries.length); u16(entries.length);
  u32(out.length - 22 - cdStart);   // central directory size
  u32(cdStart); u16(0);
  return out;
}
