/* A node:test reporter that prints the summary scripts/record-counts.mjs
   reads: "name: N/M passed". Pair it with the tap reporter so the per-test
   output stays. REQPUB_SUITE names the line; the default is node-test. */
export default async function * house(source) {
  let pass = 0;
  let fail = 0;
  for await (const event of source) {
    if (event.type === 'test:pass' && event.data && event.data.details && event.data.details.type === 'test') pass++;
    else if (event.type === 'test:fail' && event.data && event.data.details && event.data.details.type === 'test') fail++;
  }
  const name = process.env.REQPUB_SUITE || 'node-test';
  const total = pass + fail;
  yield name + ': ' + pass + '/' + total + ' passed\n';
}
