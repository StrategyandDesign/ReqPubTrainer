# The seal-receipt function

`index.ts` is the source. `core.js` is a **copy of `app/js/core.js`**, placed
here because a Deno edge function cannot import across the repository. It is
byte-identical to its source and must stay that way: `tests/seal-fixture.test.mjs`
compares the bytes and fails the build on any difference, which is why the file
carries no banner of its own.

`dist/index.ts` is **generated** by `scripts/bundle-seal-function.mjs`.
Do not edit it by hand. Regenerate it and deploy that.
