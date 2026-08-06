/* ReqPub v2 - STORE-zip writer tests (node tests/zipstore.test.mjs)
   The test does not trust the writer: it walks the produced bytes with an
   independent little reader (EOCD → central directory → local headers),
   recomputes every CRC-32 with its own table, and extracts the stored bytes
   by offset. Determinism is asserted byte-for-byte: the implementation
   package for a given baseline must always be the identical archive. */
import assert from 'node:assert/strict';
import { zipStore, crc32 } from '../app/js/zipstore.js';

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  ✓ ' + name); };

/* Independent CRC-32 (bitwise, no table) so the writer cannot grade itself. */
const crcRef = (bytes) => {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
};

/* Independent reader: EOCD → central entries → local headers → stored data. */
function readZip(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0; i--) if (dv.getUint32(i, true) === 0x06054B50) { eocd = i; break; }
  assert.ok(eocd >= 0, 'EOCD found');
  const count = dv.getUint16(eocd + 10, true);
  const cdSize = dv.getUint32(eocd + 12, true);
  const cdStart = dv.getUint32(eocd + 16, true);
  assert.equal(cdStart + cdSize + 22, buf.length, 'central directory accounts for every byte');
  const files = [];
  let p = cdStart;
  const td = new TextDecoder();
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014B50, 'central header signature');
    const crc = dv.getUint32(p + 16, true);
    const csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true);
    const off = dv.getUint32(p + 42, true);
    const name = td.decode(buf.slice(p + 46, p + 46 + nameLen));
    assert.equal(dv.getUint32(off, true), 0x04034B50, 'local header signature for ' + name);
    assert.equal(dv.getUint16(off + 8, true), 0, 'method is STORE');
    const lNameLen = dv.getUint16(off + 26, true), lExtra = dv.getUint16(off + 28, true);
    const dataStart = off + 30 + lNameLen + lExtra;
    files.push({ name, crc, size, csize, data: buf.slice(dataStart, dataStart + size),
      time: dv.getUint16(p + 12, true), date: dv.getUint16(p + 14, true) });
    p += 46 + nameLen;
  }
  return files;
}

const WHEN = '2026-07-13T15:30:00Z';

test('a two-file archive round-trips through an independent reader', () => {
  const zip = zipStore([{ name: 'requirements.json', data: '{"ok":true}' }, { name: 'docs/CHANGES.md', data: '# v2.0' }], WHEN);
  const files = readZip(zip);
  assert.deepEqual(files.map((f) => f.name), ['requirements.json', 'docs/CHANGES.md']);
  assert.equal(new TextDecoder().decode(files[0].data), '{"ok":true}');
  assert.equal(new TextDecoder().decode(files[1].data), '# v2.0');
});

test('every stored CRC-32 matches an independent recomputation', () => {
  const zip = zipStore([{ name: 'a.txt', data: 'The record defends itself.' }, { name: 'b.bin', data: new Uint8Array([0, 255, 1, 254]) }], WHEN);
  for (const f of readZip(zip)) {
    assert.equal(f.crc, crcRef(f.data), 'crc for ' + f.name);
    assert.equal(f.size, f.csize, 'stored means uncompressed size equals compressed');
  }
});

test('crc32 matches the published check value for "123456789"', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
});

test('an empty file carries crc 0 and size 0', () => {
  const [f] = readZip(zipStore([{ name: 'empty.txt', data: '' }], WHEN));
  assert.equal(f.crc, 0);
  assert.equal(f.size, 0);
});

test('the archive is deterministic: same inputs, identical bytes', () => {
  const files = [{ name: 'x.md', data: 'same' }, { name: 'y.json', data: '{}' }];
  const a = zipStore(files, WHEN), b = zipStore(files, WHEN);
  assert.equal(a.length, b.length);
  assert.ok(a.every((v, i) => v === b[i]));
});

test('the DOS stamp derives from the baseline date in UTC, not the clock', () => {
  const [f] = readZip(zipStore([{ name: 'a', data: 'x' }], '2026-07-13T15:30:00Z'));
  assert.equal(f.date, ((2026 - 1980) << 9) | (7 << 5) | 13);
  assert.equal(f.time, (15 << 11) | (30 << 5) | 0);
});

test('UTF-8 content and names are encoded and recovered intact', () => {
  const [f] = readZip(zipStore([{ name: 'résumé.md', data: 'naïve — café' }], WHEN));
  assert.equal(f.name, 'résumé.md');
  assert.equal(new TextDecoder().decode(f.data), 'naïve — café');
});

test('duplicate or empty names are refused before any bytes are written', () => {
  assert.throws(() => zipStore([{ name: 'a', data: '1' }, { name: 'a', data: '2' }], WHEN));
  assert.throws(() => zipStore([{ name: '', data: '1' }], WHEN));
});

console.log('\nzipstore.test: ' + n + '/' + n + ' passed');
