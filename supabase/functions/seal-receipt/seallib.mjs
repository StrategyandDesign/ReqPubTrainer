/* ReqPub v2 - sealing core, pure and testable in Node and Deno alike.
   The receipt build, the fingerprint-divergence abort, Ed25519 signing,
   and the RFC 3161 request bytes. docs/VERIFY.md section 9 is the spec.
   No authority capture, by owner decision. */
import { canonicalJson, sha256Hex, versionFingerprint } from './core.js';

export const RECEIPT_FORMAT = 'reqpub-receipt';
export const RECEIPT_FORMAT_VERSION = 1;

const hexToBytes = (h) => Uint8Array.from(h.match(/.{2}/g).map((b) => parseInt(b, 16)));

/* Build the receipt from a seal context. Throws on fingerprint divergence:
   sealing a divergent pair would be manufacturing evidence. */
export async function buildReceipt(ctx, chain, kid, nowIso) {
  const recomputed = await versionFingerprint({ label: ctx.label, seq: ctx.seq, snapshot: ctx.snapshot });
  const captured = ctx.fingerprint || '';
  // v2.49 hardening: an absent captured fingerprint no longer builds silently.
  // The legacy path (requests that predate capture, VERIFY.md section 9) must
  // be named at the call site, so blanking the fingerprint can never sidestep
  // the divergence abort. The seal function sets the flag from the stored row.
  if (!captured && ctx.legacyNoFingerprint !== true) {
    const e = new Error('refusing to seal without a captured fingerprint; a legacy request must opt in explicitly');
    e.divergence = true; throw e;
  }
  if (captured && recomputed !== captured) {
    const e = new Error('fingerprint divergence: captured ' + captured + ', recomputed ' + recomputed);
    e.divergence = true; throw e;
  }
  return {
    format: RECEIPT_FORMAT, formatVersion: RECEIPT_FORMAT_VERSION,
    receiptId: ctx.receiptId, sealedAt: nowIso,
    // v2.55: a rehearsal states itself in its own seal. Present only when
    // true, so every receipt sealed before practice mode is byte-unchanged.
    ...(ctx.practice === true ? { practice: true } : {}),
    // v2.49 fix: sha256Hex is async; unawaited it serialized as {} in every
    // receipt where the spec promises the project-name hash. Receipts sealed
    // before this fix stay valid: each verifies against its own bytes.
    project: { id: ctx.projectId, nameSha256: await sha256Hex(String(ctx.project || '')) },
    baseline: { label: ctx.label, seq: ctx.seq, docFingerprint: captured, recomputedFingerprint: recomputed,
      ...(captured ? {} : { fingerprintNote: 'captured-at-send absent; the fingerprint was recomputed from the stored snapshot at seal time' }) },
    signature: {
      signRequestId: ctx.signRequestId, signedName: ctx.signedName,
      signerRole: (ctx.signer && ctx.signer.role) || '',
      signerEmailDomain: (ctx.signer && ctx.signer.emailDomain) || '',
      signedAt: ctx.signedAt, channel: (ctx.evidence && ctx.evidence.channel) || 'link',
    },
    chain: chain && chain.ok ? { headSeq: Number(chain.head_seq), headHash: chain.head_hash }
                             : { headSeq: null, headHash: null, reason: 'chain_unavailable' },
    issuer: { name: 'ReqPub', kid },
  };
}

export async function canonicalHashOf(receipt) { return await sha256Hex(canonicalJson(receipt)); }

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
const bytesToB64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));

export async function signReceiptHash(hashHex, pkcs8Base64) {
  const key = await crypto.subtle.importKey('pkcs8', b64ToBytes(pkcs8Base64), { name: 'Ed25519' }, false, ['sign']);
  return bytesToB64(await crypto.subtle.sign({ name: 'Ed25519' }, key, hexToBytes(hashHex)));
}

export async function verifyReceiptHash(hashHex, sigBase64, spkiBase64) {
  const key = await crypto.subtle.importKey('spki', b64ToBytes(spkiBase64), { name: 'Ed25519' }, false, ['verify']);
  return crypto.subtle.verify({ name: 'Ed25519' }, key, b64ToBytes(sigBase64), hexToBytes(hashHex));
}

/* RFC 3161 TimeStampReq over a SHA-256 hash: version 1, messageImprint
   {sha256 AlgorithmIdentifier, the 32 bytes}, certReq true. Minimal DER. */
export function tsaRequestDer(hashHex) {
  const hash = hexToBytes(hashHex);
  if (hash.length !== 32) throw new Error('need a 32-byte hash');
  const oid = [0x06, 0x09, 0x60, 0x86, 0x48, 0x01, 0x65, 0x03, 0x04, 0x02, 0x01];
  const algo = [0x30, 0x0d, ...oid, 0x05, 0x00];
  const imprint = [0x30, 2 + algo.length + 32, ...algo, 0x04, 0x20, ...hash];
  const body = [0x02, 0x01, 0x01, ...imprint, 0x01, 0x01, 0xff];
  return Uint8Array.from([0x30, body.length, ...body]);
}

/* Parse only the leading PKIStatus of a TimeStampResp. granted 0 or
   grantedWithMods 1 count as granted; everything else does not. */
export function tsaGranted(replyBytes) {
  const b = replyBytes instanceof Uint8Array ? replyBytes : new Uint8Array(replyBytes);
  try {
    let i = 0;
    if (b[i++] !== 0x30) return false;
    if (b[i] & 0x80) i += 1 + (b[i] & 0x7f); else i += 1;
    if (b[i++] !== 0x30) return false;
    if (b[i] & 0x80) i += 1 + (b[i] & 0x7f); else i += 1;
    if (b[i++] !== 0x02) return false;
    const len = b[i++];
    const status = b[i + len - 1];
    return status === 0 || status === 1;
  } catch { return false; }
}
