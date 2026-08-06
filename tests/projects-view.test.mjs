/* ReqPub v2 - projects grid regression (node tests/projects-view.test.mjs)
   Born from a real defect: a switcher was concatenated into the per-card
   return, so every project card carried a copy of it and the grid broke.
   This suite renders the projects view and pins the shape: one card per
   project, no stray workspace chips, banners intact. */
import assert from 'node:assert/strict';

globalThis.location = { origin: 'https://reqpub.com', pathname: '/app/' };
const { viewProjects } = await import('../app/js/views-app.js');

let n = 0;
const test = (name, fn) => { fn(); n++; console.log('  \u2713 ' + name); };

const APP = () => ({
  role: 'manager', orgId: 'org-a', org: 'Collection Ventures',
  ctx: { memberships: [
    { org_id: 'org-a', org_name: 'Collection Ventures', role: 'manager' },
    { org_id: 'org-b', org_name: 'My workspace', role: 'manager' },
  ] },
  projects: [
    { id: 'p1', name: 'Fathering Excellence Profile', archived: false, updated_at: '2026-07-30T20:00:00Z' },
    { id: 'p2', name: 'Esign API', archived: false, updated_at: '2026-07-30T15:00:00Z' },
  ],
  projectStats: {}, myApprovals: [], versionsByProject: {},
});

test('exactly one card per project, nothing multiplied into the grid', () => {
  const html = viewProjects(APP());
  assert.equal((html.match(/class="pcard/g) || []).length, 2, 'two projects, two cards');
  assert.ok(html.includes('Fathering Excellence Profile') && html.includes('Esign API'));
});

test('no workspace chips inside the grid: the account-bar menu is the one switcher', () => {
  const html = viewProjects(APP());
  assert.ok(!html.includes('data-action="orgswitch"'), 'switching lives in the workspace menu, not the grid');
  assert.ok(!html.includes('orgSwitcherHTML'), 'the injected helper is gone');
});

console.log('\nprojects-view.test: ' + n + '/' + n + ' passed');
