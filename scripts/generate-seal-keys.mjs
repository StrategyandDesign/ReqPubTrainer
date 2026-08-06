#!/usr/bin/env node
/* ReqPub v2.48 - one-time seal key generation. Prints everything once and
   writes nothing to disk. Run locally, set the secrets, paste the SQL,
   update reqpub-keys.json, then close the terminal. */
import { generateKeyPairSync } from 'node:crypto';
const mk = (kid) => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return { kid,
    pub: publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    priv: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64') };
};
const acc = mk('acc-1'), whk = mk('whk-1');
const now = new Date().toISOString();
console.log('== 1) Set the function secrets (paste each, then clear your history) ==');
console.log(`supabase secrets set RECEIPT_SIGNING_KEY=${acc.priv}`);
console.log(`supabase secrets set WEBHOOK_SIGNING_KEY=${whk.priv}`);
console.log('\n== 2) Replace the contents of reqpub-keys.json at the site root ==');
console.log(JSON.stringify({ keys: [
  { kid: 'acc-1', alg: 'Ed25519', publicKeySpkiBase64: acc.pub, createdAt: now },
  { kid: 'whk-1', alg: 'Ed25519', publicKeySpkiBase64: whk.pub, createdAt: now },
] }, null, 2));
console.log('\n== 3) Run in the Supabase SQL editor ==');
console.log(`insert into receipt_keys(kid, public_key_spki_base64) values ('acc-1','${acc.pub}'),('whk-1','${whk.pub}') on conflict (kid) do update set public_key_spki_base64 = excluded.public_key_spki_base64;`);
console.log('\n== 4) Timestamp the published key file ==');
console.log('node scripts/timestamp-keys.mjs   (commits reqpub-keys.json.tsr files)');
console.log('\nPrivate keys were printed once above and exist nowhere else.');
