#!/usr/bin/env node
/* ReqPub v2.48 - timestamp the published key file. Requests dual RFC 3161
   timestamps over the exact bytes of reqpub-keys.json and writes the raw
   .tsr replies beside it, to be committed. Run whenever the file changes. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tsaRequestDer, tsaGranted } from '../supabase/functions/seal-receipt/seallib.mjs';
globalThis.location = globalThis.location || { origin: 'https://reqpub.com', pathname: '/' };
const bytes = readFileSync('reqpub-keys.json');
const hash = createHash('sha256').update(bytes).digest('hex');
const der = tsaRequestDer(hash);
const targets = [['primary', 'https://freetsa.org/tsr'], ['secondary', 'http://timestamp.digicert.com']];
for (const [name, url] of targets) {
  try {
    const r = await fetch(url, { method: 'POST', body: der, headers: { 'Content-Type': 'application/timestamp-query', 'Accept': 'application/timestamp-reply' } });
    const reply = new Uint8Array(await r.arrayBuffer());
    if (!r.ok || !tsaGranted(reply)) { console.log(name + ': not granted'); continue; }
    writeFileSync('reqpub-keys.json.' + name + '.tsr', reply);
    console.log(name + ': granted, wrote reqpub-keys.json.' + name + '.tsr');
  } catch (e) { console.log(name + ': unreachable, ' + e.message); }
}
console.log('sha256(reqpub-keys.json) = ' + hash);
