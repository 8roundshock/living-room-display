// #710: the full-dependency audit fails on any high or critical advisory outside the documented allowlist.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { advisoriesOf, AUDIT_ALLOWLIST, auditProblems } from '../../scripts/check-audit.mjs';

const advisory = (id, name, severity, title = `${name} advisory`) => ({ source: 1, name, dependency: name, title, url: `https://github.com/advisories/${id}`, severity, range: '<=1' });
/** An `npm audit --json` report shaped like the real one of 2026-11-17 (picomatch through Vite), plus extra advisories. */
function report(extra = [], counts = {}) {
  const vulnerabilities = {
    '@vitejs/plugin-react': { name: '@vitejs/plugin-react', severity: 'high', isDirect: true, via: ['vite'] },
    fdir: { name: 'fdir', severity: 'high', isDirect: false, via: ['picomatch'] },
    picomatch: { name: 'picomatch', severity: 'high', isDirect: false, via: [advisory('GHSA-fc5q-39xc-vjpf', 'picomatch', 'high', 'picomatch vulnerable to ReDoS through single-branch repeated extglobs')] },
    tinyglobby: { name: 'tinyglobby', severity: 'high', isDirect: false, via: ['picomatch'] },
    vite: { name: 'vite', severity: 'high', isDirect: true, via: ['picomatch'] },
  };
  for (const item of extra) vulnerabilities[item.name] = { name: item.name, severity: item.severity, isDirect: false, via: [item] };
  const all = Object.values(vulnerabilities);
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: all.filter(v => v.severity === 'high').length, critical: all.filter(v => v.severity === 'critical').length, total: all.length, ...counts } } };
}

test('The allowlist holds only the picomatch advisory, pointing at #710', () => {
  assert.deepEqual(AUDIT_ALLOWLIST, { 'GHSA-fc5q-39xc-vjpf': 'https://github.com/8roundshock/living-room-display/issues/710' });
  assert.match(readFileSync(new URL('../../docs/development.md', import.meta.url), 'utf8'), /GHSA-fc5q-39xc-vjpf/, 'documented with its assessment');
});

test('Today’s report passes: one allowlisted advisory, the four packages affected through it are not counted again', () => {
  assert.deepEqual(advisoriesOf(report()).map(item => item.id), ['GHSA-fc5q-39xc-vjpf']);
  const result = auditProblems(report());
  assert.deepEqual(result.problems, []); assert.deepEqual(result.allowed.map(item => item.id), ['GHSA-fc5q-39xc-vjpf']); assert.deepEqual(result.notes, []);
});

test('A new high or critical advisory fails; moderate and low do not', () => {
  assert.deepEqual(auditProblems(report([advisory('GHSA-aaaa-bbbb-cccc', 'rollup', 'high', 'path traversal')])).problems, ['high GHSA-aaaa-bbbb-cccc in rollup: path traversal']);
  assert.equal(auditProblems(report([advisory('GHSA-dddd-eeee-ffff', 'esbuild', 'critical')])).problems.length, 1);
  assert.deepEqual(auditProblems(report([advisory('GHSA-gggg-hhhh-iiii', 'postcss', 'moderate'), advisory('GHSA-jjjj-kkkk-llll', 'nanoid', 'low')])).problems, []);
  // An allowlisted advisory stays allowed if npm raises its severity; anything else at that level does not.
  const raised = report(); raised.vulnerabilities.picomatch.via[0].severity = 'critical';
  assert.deepEqual(auditProblems(raised).problems, []);
});

test('A report npm could not produce, or one whose shape changed, fails', () => {
  assert.match(auditProblems({ error: { code: 'ENOTFOUND', summary: 'registry unreachable' } }).problems[0], /did not produce a report: registry unreachable/);
  assert.equal(auditProblems(null).problems.length, 1); assert.equal(auditProblems({}).problems.length, 1);
  assert.equal(auditProblems({ auditReportVersion: 1, advisories: {} }).problems.length, 1, 'an older report format');
  const hidden = report(); hidden.vulnerabilities = { vite: { name: 'vite', severity: 'high', via: ['something'] } };
  assert.match(auditProblems(hidden).problems[0], /found no advisory/, 'counts without an advisory object');
});

test('When the advisory is fixed upstream, the check notes the stale allowlist entry', () => {
  const clean = { auditReportVersion: 2, vulnerabilities: {}, metadata: { vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 } } };
  const result = auditProblems(clean);
  assert.deepEqual(result.problems, []); assert.match(result.notes[0], /GHSA-fc5q-39xc-vjpf is no longer reported: remove it from AUDIT_ALLOWLIST and update .*issues\/710/);
});
