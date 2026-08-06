#!/usr/bin/env node
/* Preflight for the backend suites.
 *
 * `embedded-postgres` hard-codes LC_MESSAGES=en_US.UTF-8 because it parses
 * initdb's output to decide when the cluster is ready, and it needs that
 * output in a known language. On an image without that locale, initdb fails
 * with a message about locale settings that says nothing about the real cause,
 * and the only way through is to patch the dependency in node_modules.
 *
 * An independent reviewer running these suites hit exactly that and had to
 * edit a file inside node_modules to get Postgres to boot. They told us, which
 * is the only reason we know: the maintainer's image has the locale, so the
 * defect is invisible from here.
 *
 * This check runs before the backend chain and turns a mystery into an
 * instruction. It does not change any test semantics; it fails earlier and
 * says why.
 */
import { execSync } from 'node:child_process';

const WANT = 'en_US.UTF-8';

function available() {
  try {
    const out = execSync('locale -a', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const names = out.split('\n').map((l) => l.trim().toLowerCase().replace(/-/g, ''));
    return names.includes('en_us.utf8') || names.includes('en_us.utf-8'.replace(/-/g, ''));
  } catch {
    return null;                      // no `locale` command: not a Linux image, let it run
  }
}

const has = available();
if (has === false) {
  console.error(`
backend preflight: the locale ${WANT} is not installed on this machine.

The embedded PostgreSQL used by the backend suites hard-codes that locale
because it reads initdb's output to know when the cluster is ready. Without it,
initdb fails with a message about locale settings that does not name the cause.

On a Debian or Ubuntu image:

    apt-get install -y locales \\
      && sed -i 's/^# *en_US.UTF-8/en_US.UTF-8/' /etc/locale.gen \\
      && locale-gen

On an Alpine image, install musl-locales, or run the suites in a container
that has the locale.

The unit chain needs none of this: it runs with no install and no database.

    npm test
`);
  process.exit(1);
}
console.log(has === null
  ? 'backend preflight: locale check skipped, no `locale` command on this platform'
  : `backend preflight: ${WANT} present`);
