/* A synthetic RFC 3161 TimeStampResp, built byte by byte with an ephemeral
   RSA key and a self-signed certificate, for suites that need a real token
   over a given hash without reaching a public authority. Independent of the
   verify CLI's reader on purpose: two implementations of the same RFC, meeting
   in the middle. Test fixture only; nothing in the product imports this. */
import { createHash, generateKeyPairSync, sign as cryptoSign } from 'node:crypto';

/* ---- a small DER writer ---- */
const len = (n) => n < 0x80 ? [n] : n < 0x100 ? [0x81, n] : n < 0x10000 ? [0x82, n >> 8, n & 0xff] : [0x83, n >> 16, (n >> 8) & 0xff, n & 0xff];
const enc = (tag, ...parts) => { const body = Buffer.concat(parts.map((p) => Buffer.from(p))); return Buffer.concat([Buffer.from([tag, ...len(body.length)]), body]); };
const SEQ = (...p) => enc(0x30, ...p), SET = (...p) => enc(0x31, ...p), OCT = (b) => enc(0x04, b), NUL = enc(0x05);
const CTX = (k, ...p) => enc(0xa0 + k, ...p);            // context-specific, constructed
const INT = (v) => { let h = BigInt(v).toString(16); if (h.length % 2) h = '0' + h; let b = Buffer.from(h, 'hex'); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return enc(0x02, b); };
const OID = (s) => { const p = s.split('.').map(Number); const out = [40 * p[0] + p[1]]; for (const v of p.slice(2)) { const st = []; let x = v; do { st.unshift(x & 0x7f); x >>= 7; } while (x); for (let i = 0; i < st.length - 1; i++) st[i] |= 0x80; out.push(...st); } return enc(0x06, out); };
const UTF8 = (s) => enc(0x0c, Buffer.from(s, 'utf8'));
const GEN_TIME = (iso) => enc(0x18, Buffer.from(iso.replace(/[-:T]/g, '').replace(/\.\d+Z$/, 'Z'), 'latin1'));
const UTC_TIME = (s) => enc(0x17, Buffer.from(s, 'latin1'));
const BITS = (b) => enc(0x03, Buffer.concat([Buffer.from([0]), b]));

const oid = {
  signedData: '1.2.840.113549.1.7.2', tstInfo: '1.2.840.113549.1.9.16.1.4', contentType: '1.2.840.113549.1.9.3', messageDigest: '1.2.840.113549.1.9.4',
  sha256: '2.16.840.1.101.3.4.2.1', rsa: '1.2.840.113549.1.1.1', rsaSha256: '1.2.840.113549.1.1.11', cn: '2.5.4.3', policy: '1.3.6.1.4.1.99999.1'
};
const name = (cn) => SEQ(SET(SEQ(OID(oid.cn), UTF8(cn))));

/* A self-signed X.509 v3 certificate, enough for the reader to find the
   subject public key and the subject CN. */
export function selfSignedCert(keys, cn, serial) {
  const spki = keys.publicKey.export({ format: 'der', type: 'spki' });
  const tbs = SEQ(CTX(0, INT(2)), INT(serial), SEQ(OID(oid.rsaSha256), NUL), name(cn),
    SEQ(UTC_TIME('260101000000Z'), UTC_TIME('360101000000Z')), name(cn), spki);
  const sig = cryptoSign('sha256', tbs, keys.privateKey);
  return SEQ(tbs, SEQ(OID(oid.rsaSha256), NUL), BITS(sig));
}

/* TimeStampResp = { PKIStatusInfo, TimeStampToken }. Options break it. */
export function timestampResponse(keys, cert, serial, hashHex, opts = {}) {
  const status = SEQ(INT(opts.status ?? 0));
  const imprint = SEQ(SEQ(OID(oid.sha256), NUL), OCT(Buffer.from(opts.imprintHex || hashHex, 'hex')));
  const tstInfo = SEQ(INT(1), OID(oid.policy), imprint, INT(opts.tsaSerial || 4242), GEN_TIME(opts.genTime || '2026-08-05T12:34:56Z'));
  const digest = createHash('sha256').update(tstInfo).digest();
  const attrs = [SEQ(OID(oid.contentType), SET(OID(oid.tstInfo))), SEQ(OID(oid.messageDigest), SET(OCT(opts.wrongDigest ? Buffer.alloc(32, 7) : digest)))];
  const signedAttrsSet = SET(...attrs);                   // what is signed: the SET form
  const signedAttrsImplicit = CTX(0, ...attrs);           // what is encoded: [0] IMPLICIT
  const sig = cryptoSign('sha256', signedAttrsSet, keys.privateKey);
  if (opts.flipSignature) sig[10] ^= 0xff;
  const digestOid = opts.signerDigestOid || oid.sha256;      // a digest this reader does not know marks the token unchecked, never failed
  const signerInfo = SEQ(INT(1), SEQ(name('Synthetic Test TSA'), INT(serial)), SEQ(OID(digestOid), NUL), signedAttrsImplicit, SEQ(OID(oid.rsa), NUL), OCT(sig));
  const signedData = SEQ(INT(3), SET(SEQ(OID(oid.sha256), NUL)), SEQ(OID(oid.tstInfo), CTX(0, OCT(tstInfo))),
    ...(opts.noCert ? [] : [CTX(0, cert)]), SET(signerInfo));
  const token = SEQ(OID(oid.signedData), CTX(0, signedData));
  return opts.noToken ? SEQ(status) : SEQ(status, token);
}

/* One authority: keys, certificate, serial, and a response(hashHex, opts)
   bound to them. */
export function syntheticAuthority(cn = 'Synthetic Test TSA', serial = 77) {
  const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const cert = selfSignedCert(keys, cn, serial);
  return { keys, cert, serial, response: (hashHex, opts) => timestampResponse(keys, cert, serial, hashHex, opts) };
}
