/* ReqPub offline verification, shared.
   The recipe from docs/VERIFY.md: canonical JSON, SHA-256, the Ed25519 seal
   over the canonical receipt hash, and the RFC 3161 token reader. Node
   built-ins only. This module imports nothing from the ReqPub application.
   tools/reqpub-verify.mjs is the command, and tools/spec-drift-gate.mjs
   calls the same functions, so the gate does not reimplement the crypto. */
import { createHash, verify as edVerify, verify as sigVerify, createPublicKey } from 'node:crypto';

export function canonical(v) {
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return JSON.stringify(v);
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'undefined') return 'null';
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (typeof v === 'object') {
    const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  }
  return 'null';
}

export const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

const hexToBytes = (h) => Uint8Array.from(h.match(/.{2}/g).map((b) => parseInt(b, 16)));

/* RFC 3161 timestamp tokens, restated from docs/VERIFY.md section 9 step 3
   (v3.1). Until this release the tool printed an openssl command and left
   the token unread, so a receipt's timestamp status was a stored claim.
   This walks the DER itself, on node builtins:
     - TimeStampResp.status must be granted (0) or grantedWithMods (1);
     - TSTInfo.messageImprint must be SHA-256 of exactly this receipt's
       canonical hash, and genTime is read from the token;
     - the CMS signature is checked: the message-digest attribute equals the
       hash of the TSTInfo bytes, and the signature over the signed
       attributes verifies against a certificate carried inside the token
       (RSA PKCS#1 v1.5 and ECDSA, SHA-256/384/512).
   What this does not do: validate that certificate up to a root the
   reader trusts. That is a trust decision, and the openssl command printed
   for each token performs it against a CA file the reader supplies.
   A tolerant reader: definite-length DER only, unknown elements skipped. */
const OID = {
  '1.2.840.113549.1.7.2': 'signedData', '1.2.840.113549.1.9.16.1.4': 'tstInfo',
  '1.2.840.113549.1.9.3': 'contentType', '1.2.840.113549.1.9.4': 'messageDigest',
  '2.16.840.1.101.3.4.2.1': 'sha256', '2.16.840.1.101.3.4.2.2': 'sha384', '2.16.840.1.101.3.4.2.3': 'sha512', '1.3.14.3.2.26': 'sha1',
  '1.2.840.113549.1.1.1': 'rsa', '1.2.840.113549.1.1.11': 'rsa-sha256', '1.2.840.113549.1.1.12': 'rsa-sha384', '1.2.840.113549.1.1.13': 'rsa-sha512',
  '1.2.840.10045.2.1': 'ec', '1.2.840.10045.4.3.2': 'ecdsa-sha256', '1.2.840.10045.4.3.3': 'ecdsa-sha384', '1.2.840.10045.4.3.4': 'ecdsa-sha512',
  '2.5.4.3': 'cn'
};
function tlv(b, i) {
  if (i + 2 > b.length) throw new Error('truncated');
  const tag = b[i]; let len = b[i + 1]; let j = i + 2;
  if (len & 0x80) { const n = len & 0x7f; if (n === 0 || n > 4) throw Object.assign(new Error('indefinite or oversized length'), { unsupported: true }); len = 0; for (let k = 0; k < n; k++) len = (len << 8) | b[j++]; }
  if (j + len > b.length) throw new Error('truncated');
  return { tag, hdr: i, start: j, end: j + len, next: j + len };
}
function kids(b, t) { const out = []; let i = t.start; while (i < t.end) { const c = tlv(b, i); out.push(c); i = c.next; } return out; }
function oidOf(b, t) {
  const bytes = b.subarray(t.start, t.end); const parts = [Math.floor(bytes[0] / 40), bytes[0] % 40]; let v = 0;
  for (let i = 1; i < bytes.length; i++) { v = v * 128 + (bytes[i] & 0x7f); if (!(bytes[i] & 0x80)) { parts.push(v); v = 0; } }
  return parts.join('.');
}
const bytesOf = (b, t) => b.subarray(t.start, t.end);
const hexOf = (b, t) => Buffer.from(bytesOf(b, t)).toString('hex');
const intOf = (b, t) => { let v = 0; for (const x of bytesOf(b, t)) v = v * 256 + x; return v; };
function timeOf(b, t) {
  const s = Buffer.from(bytesOf(b, t)).toString('latin1');                        // GeneralizedTime YYYYMMDDHHMMSS[.fff]Z
  const m = s.match(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\.(\d+))?Z$/);
  return m ? m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' + m[6] + 'Z' : s;
}
function cnOf(b, name) {                                                        // Name → the first CN found
  for (const rdn of kids(b, name)) for (const atv of kids(b, rdn)) {
    const [type, value] = kids(b, atv);
    if (type && value && OID[oidOf(b, type)] === 'cn') return Buffer.from(bytesOf(b, value)).toString('utf8');
  }
  return '';
}
function spkiOfCert(b, cert) {
  const tbs = kids(b, cert)[0];
  const f = kids(b, tbs);
  const i = (f[0] && f[0].tag === 0xa0) ? 1 : 0;                                   // [0] version is optional
  const serial = f[i], subject = f[i + 4], spki = f[i + 5];
  return { spkiDer: Buffer.from(b.subarray(spki.hdr, spki.end)), cn: cnOf(b, subject), serial: hexOf(b, serial) };
}
export function verifyTimestampToken(bytes, canonHashHex) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const fail = (reason) => ({ ok: false, reason });
  // A token this reader cannot check is reported as unchecked, never as a
  // failure: the openssl command still verifies it. Only a token that is
  // readable and wrong fails the receipt.
  const unsupported = (reason) => ({ ok: false, unsupported: true, reason });
  try {
    const resp = tlv(b, 0); if (resp.tag !== 0x30) return fail('not a DER sequence');
    const [statusInfo, token] = kids(b, resp);
    const status = intOf(b, kids(b, statusInfo)[0]);
    if (status !== 0 && status !== 1) return fail('status ' + status + ' is not granted');
    if (!token) return fail('granted, but the response carries no token');
    const [ctype, content] = kids(b, token);
    if (OID[oidOf(b, ctype)] !== 'signedData') return fail('token is not CMS SignedData');
    const sd = kids(b, content)[0];
    const sdf = kids(b, sd); // version, digestAlgorithms, encapContentInfo, certs, signerInfos
    const eci = sdf[2];
    const [eType, eWrap] = kids(b, eci);
    if (OID[oidOf(b, eType)] !== 'tstInfo') return fail('encapsulated content is not TSTInfo');
    const eContent = kids(b, eWrap)[0];                                           // OCTET STRING holding the TSTInfo DER
    const tstBytes = bytesOf(b, eContent);
    const tst = tlv(tstBytes, 0);
    const tf = kids(tstBytes, tst);                                               // version, policy, messageImprint, serial, genTime, ...
    const [impAlg, impHash] = kids(tstBytes, tf[2]);
    const impAlgName = OID[oidOf(tstBytes, kids(tstBytes, impAlg)[0])];
    if (impAlgName !== 'sha256') return fail('message imprint algorithm is ' + (impAlgName || 'unknown') + ', not SHA-256');
    const imprint = hexOf(tstBytes, impHash);
    if (imprint !== canonHashHex.toLowerCase()) return fail('message imprint ' + imprint.slice(0, 16) + '… is not this receipt');
    const genTime = timeOf(tstBytes, tf[4]);
    const serial = hexOf(tstBytes, tf[3]);
    // the signature
    const certs = sdf.find((x) => x.tag === 0xa0);
    const signerInfos = sdf[sdf.length - 1];
    const si = kids(b, signerInfos)[0];
    const sif = kids(b, si); // version, sid, digestAlgorithm, signedAttrs, signatureAlgorithm, signature
    let k = 2;
    const digestName = OID[oidOf(b, kids(b, sif[k++])[0])];
    if (!/^sha(256|384|512)$/.test(digestName || '')) return unsupported('digest algorithm ' + (digestName || 'unknown') + ' is not read by this tool');
    const signedAttrs = sif[k].tag === 0xa0 ? sif[k++] : null;
    if (!signedAttrs) return fail('token carries no signed attributes');
    const sigAlgName = OID[oidOf(b, kids(b, sif[k++])[0])];
    const signature = bytesOf(b, sif[k]);
    let md = null;
    for (const attr of kids(b, signedAttrs)) {
      const [type, values] = kids(b, attr);
      if (OID[oidOf(b, type)] === 'messageDigest') md = hexOf(b, kids(b, values)[0]);
    }
    const tstDigest = createHash(digestName).update(tstBytes).digest('hex');
    if (md !== tstDigest) return fail('the message-digest attribute does not match the TSTInfo');
    const signed = Buffer.from(b.subarray(signedAttrs.hdr, signedAttrs.end)); signed[0] = 0x31;   // IMPLICIT [0] → SET for the signature
    const hashForSig = { rsa: digestName, 'rsa-sha256': 'sha256', 'rsa-sha384': 'sha384', 'rsa-sha512': 'sha512',
      ec: digestName, 'ecdsa-sha256': 'sha256', 'ecdsa-sha384': 'sha384', 'ecdsa-sha512': 'sha512' }[sigAlgName];
    if (!hashForSig) return unsupported('signature algorithm ' + (sigAlgName || 'unknown') + ' is not read by this tool');
    if (!certs) return fail('token carries no certificate to verify against');
    let signer = null;
    for (const cert of kids(b, certs)) {
      let c; try { c = spkiOfCert(b, cert); } catch { continue; }
      try {
        const key = createPublicKey({ key: c.spkiDer, format: 'der', type: 'spki' });
        if (sigVerify(hashForSig, signed, key, Buffer.from(signature))) { signer = c; break; }
      } catch { /* a certificate whose key type cannot verify this signature is not the signer */ }
    }
    if (!signer) return fail('the signature verifies against none of the certificates in the token');
    return { ok: true, status, genTime, serial, signer: signer.cn || ('certificate serial ' + signer.serial), alg: sigAlgName + '/' + hashForSig };
  } catch (e) { return e && e.unsupported ? unsupported(e.message) : fail('unreadable: ' + e.message); }
}

/* The fingerprint a receipt claims for its baseline. An empty captured
   value is the legacy path in VERIFY.md section 9: compare the recomputed
   fingerprint and say so. */
export function claimedBaselineFingerprint(receipt) {
  const b0 = (receipt && receipt.baseline) || {};
  const doc = b0.docFingerprint || '';
  const recomputed = b0.recomputedFingerprint || '';
  return { claimed: doc || recomputed, legacy: !doc && !!recomputed };
}

/* Ed25519 over SHA-256 of the canonical receipt, the same check the receipt
   directory mode prints. ok is false for a bad signature, a placeholder
   key, or a key that is not an SPKI public key. */
export function verifySeal(receipt, signatureBase64, spkiBase64) {
  const canonHash = sha256Hex(canonical(receipt));
  if (!signatureBase64 || !spkiBase64) return { ok: false, canonHash, reason: 'incomplete' };
  if (String(spkiBase64).startsWith('SET-AT-DEPLOY')) return { ok: false, canonHash, reason: 'placeholder' };
  let key;
  try { key = createPublicKey({ key: Buffer.from(spkiBase64, 'base64'), format: 'der', type: 'spki' }); }
  catch { return { ok: false, canonHash, reason: 'invalid-spki' }; }
  try {
    const ok = edVerify(null, hexToBytes(canonHash), key, Buffer.from(signatureBase64, 'base64'));
    return { ok: !!ok, canonHash, reason: ok ? '' : 'invalid-signature' };
  } catch { return { ok: false, canonHash, reason: 'invalid-signature' }; }
}
