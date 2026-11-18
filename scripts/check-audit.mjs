// Full-dependency audit (#710): every dependency the build uses, dev dependencies included. The updater builds the app
// on the display PC (windows/LivingRoomDisplay.ps1, Build-InstallCandidate: npm ci, then npm run build), so Vite and its
// dependencies run there on every update, and the installer build runs them too. Fails on any high or critical advisory
// that is not in AUDIT_ALLOWLIST, so a new build-time advisory is noticed; the shipped runtime set has its own stricter
// guard (`npm audit --omit=dev --audit-level=high`, no exceptions). Usage:
//   npm audit --json > audit.json   (npm exits non-zero when it finds anything; that is expected)
//   node scripts/check-audit.mjs audit.json
// The allowlist is reviewed in docs/development.md (Dependency advisories); each entry names its ticket.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Accepted build-time advisories, by GitHub advisory id, each with the ticket that tracks its fix. */
export const AUDIT_ALLOWLIST = Object.freeze({
  // picomatch <= 4.0.7 ReDoS through Vite; no fixed release yet. The build matches only this repository's own patterns.
  'GHSA-fc5q-39xc-vjpf': 'https://github.com/8roundshock/living-room-display/issues/710',
});
const BLOCKING = new Set(['high', 'critical']);

/** The advisories in an `npm audit --json` report (format 2): id, package, severity, title. */
export function advisoriesOf(report) {
  const found = new Map();
  for (const vulnerability of Object.values(report?.vulnerabilities ?? {}))
    for (const via of vulnerability?.via ?? []) {
      // A string is a package this one is affected through; its own entry carries the advisory.
      if (!via || typeof via !== 'object') continue;
      const id = String(via.url ?? '').match(/(GHSA-[\w-]+)/)?.[1] ?? `npm-${via.source}`;
      if (!found.has(id)) found.set(id, { id, name: String(via.name ?? via.dependency ?? '?'), severity: String(via.severity ?? 'unknown'), title: String(via.title ?? '') });
    }
  return [...found.values()];
}

/** `problems` fail the check; `allowed` are the allowlisted advisories present; `notes` are allowlist entries npm no
 * longer reports (remove them and close their ticket). A report npm could not produce is a problem, never a pass. */
export function auditProblems(report, allowlist = AUDIT_ALLOWLIST) {
  if (!report || typeof report !== 'object' || report.error || report.auditReportVersion !== 2 || typeof report.vulnerabilities !== 'object' || !report.metadata?.vulnerabilities)
    return { problems: [`npm audit did not produce a report${report?.error ? `: ${report.error.summary ?? report.error.code ?? JSON.stringify(report.error)}` : ''}`], allowed: [], notes: [] };
  const advisories = advisoriesOf(report), problems = [], allowed = [];
  for (const advisory of advisories) {
    if (allowlist[advisory.id]) allowed.push(advisory);
    else if (BLOCKING.has(advisory.severity)) problems.push(`${advisory.severity} ${advisory.id} in ${advisory.name}: ${advisory.title}`);
  }
  // A high or critical count with no advisory found means the report's shape changed: fail rather than pass blindly.
  const counted = (report.metadata.vulnerabilities.high ?? 0) + (report.metadata.vulnerabilities.critical ?? 0);
  if (counted > 0 && !advisories.some(advisory => BLOCKING.has(advisory.severity)))
    problems.push(`npm reports ${counted} high or critical vulnerabilities but the check found no advisory in the report`);
  const notes = Object.keys(allowlist).filter(id => !advisories.some(advisory => advisory.id === id))
    .map(id => `${id} is no longer reported: remove it from AUDIT_ALLOWLIST and update ${allowlist[id]}`);
  return { problems, allowed, notes };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  let report = null;
  try { report = JSON.parse(readFileSync(process.argv[2] ?? 0, 'utf8')); } catch (error) { report = { error: { summary: `unreadable audit output (${error.message})` } }; }
  const { problems, allowed, notes } = auditProblems(report);
  for (const advisory of allowed) console.log(`check-audit: allowed ${advisory.severity} ${advisory.id} in ${advisory.name} (${AUDIT_ALLOWLIST[advisory.id]})`);
  for (const note of notes) console.log(`check-audit: note: ${note}`);
  for (const problem of problems) console.error(`check-audit: ${problem}`);
  if (problems.length) process.exit(1);
  console.log('check-audit: no high or critical advisory outside the allowlist.');
}
