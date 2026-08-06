/* The verify page runs the app's OWN canonicalization and hashing - the same
   canonicalJson and sha256Hex in app/js/core.js that computed the recorded
   fingerprint - imported directly, so this page cannot drift from the app.
   Fully client-side: the page's CSP sets connect-src 'none', so no network
   request is possible even by mistake. */
import { verifyBundleText } from './app/js/verifybundle.js';

const $ = (id) => document.getElementById(id);
const input = $('vf-input');
const file = $('vf-file');
const go = $('vf-go');
const result = $('vf-result');

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function show(kind, html) {
  result.className = 'vf-result show ' + kind;
  result.innerHTML = html;
}

file.addEventListener('change', async () => {
  const f = file.files && file.files[0];
  if (!f) return;
  input.value = await f.text();
});

go.addEventListener('click', async () => {
  const text = input.value.trim();
  if (!text) { show('info', 'Paste a bundle or choose a file first.'); return; }
  go.disabled = true;
  try {
    const r = await verifyBundleText(text);
    if (!r.ok) { show('bad', '<strong>Cannot verify.</strong> ' + esc(r.error)); return; }
    const hashes = '<span class="vf-hash">computed sha256:' + esc(r.computed) + '</span>' +
      (r.embedded ? '<span class="vf-hash">embedded sha256:' + esc(r.embedded) + '</span>' : '');
    if (r.match === true) {
      show('good', '<strong>Verified.</strong> This snapshot reproduces its fingerprint exactly: the file is byte-identical, under the canonical form, to the baseline the fingerprint was recorded for.' + hashes);
    } else if (r.match === false) {
      show('bad', '<strong>Mismatch.</strong> This snapshot does not produce that fingerprint. The file differs from the baseline the fingerprint was recorded for.' + hashes);
    } else {
      show('info', '<strong>No fingerprint to compare.</strong> The bundle carries no embedded fingerprint, so nothing was verified. The computed value is below; check it against the fingerprint printed on your exported document.' + hashes);
    }
  } finally {
    go.disabled = false;
  }
});
