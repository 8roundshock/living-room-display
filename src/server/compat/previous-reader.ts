/**
 * Test-only frozen reader of the previous installed release (#84 item 2). Never built or shipped:
 * tsconfig.server.json excludes src/server/compat/**.
 *
 * Provenance: ./d66832b/server/{validation,photo,persistence}.ts and
 * ./d66832b/shared/{widgets,defaults,contracts,palette,motion}.ts are byte-for-byte copies of those
 * paths at d66832b39920b3df7ea0d67e3584289539957cc8 (the merge of PR #491, installed on 2026-10-20),
 * made with `git show <sha>:<path>`: its validation.ts and every module it imports, transitively,
 * and nothing else. Never edit them; their relative imports resolve inside the copy and zod resolves
 * from the repository root. .gitattributes exempts src/server/compat/<sha>/ from whitespace checks
 * (#219), so upstream whitespace stays as it is. The installed d66832b keeps 3446400 (PR #286) as
 * app.previous. Until #497 the reader was 3446400's (#367, PR #376): npm test at d66832b passes
 * against it, so 3446400 reads what d66832b writes, and also against a temporary 3fee844 copy
 * (checked for #497). 4cb7dc1 (PR #327), installed between them, has 3446400's eight reader blobs.
 *
 * ./bedca44/ is an earlier reader (bedca44e18bcdc23f33a4ac887e3f2a57d5d41c8, same `git show`
 * copies), kept unedited as a legacy-data fixture: weather-merge.test.ts, native-accent.test.ts and
 * tests/ui/weather-browser.mjs build pre-#74/#75 data from its defaults and grid. It is no longer the
 * rollback reader; LEGACY_FIXTURE_BLOBS proves it stays unedited.
 *
 * Bumping after each coordinated install (#130): vendor the newly installed revision into
 * ./<short-sha>/ with the same `git show` commands, point the imports below,
 * VENDORED_BLOBS (`git ls-tree <sha> <paths>`) and PREVIOUS_RELEASE in ../persistence.ts at it,
 * re-baseline the tests that use the reader, and update the rollback table in docs/install.md.
 * Delete the old copy unless a test still uses it as a fixture (then move its blobs to a fixture
 * constant, as for bedca44). Omitting additive defaults at rest is optional for keys the new baseline
 * reads; #272 kept it for accentMode, animation and widgetData, and it stays the mechanism for keys
 * and widget ids the baseline does not know yet.
 */
import { dataSchema, importSchema } from './d66832b/server/validation.ts';
import { WIDGET_IDS } from './d66832b/shared/widgets.ts';

export const PREVIOUS_READER = {
  revision: 'd66832b39920b3df7ea0d67e3584289539957cc8',
  dataSchema,
  importSchema,
  widgetIds: [...WIDGET_IDS] as string[],
} as const;

/** Git blob ids of the vendored reader at PREVIOUS_READER.revision; rollback.test.ts proves the copy is unedited. */
export const VENDORED_BLOBS: Record<string, string> = {
  'd66832b/server/validation.ts': '0effea25374bdc684e3fc7cee3cdecb7be8bc578',
  'd66832b/server/photo.ts': 'f90dfd9900bbf3beeaa4b6a8647ad58e08b5a2d4',
  'd66832b/server/persistence.ts': 'aeb0bffa992f691fcd87d7bf3fe74761c176c6f6',
  'd66832b/shared/widgets.ts': '2ed993f45b665a6caaf157c2ecec786758bc0f67',
  'd66832b/shared/defaults.ts': 'a291e6a6423b61dcd795aae77bb06f036066d21f',
  'd66832b/shared/contracts.ts': '3509c65ec7c8c0845895cc1e7b50be2d146bab9d',
  'd66832b/shared/palette.ts': '7a9e16ff089aa9f167f5bd86b3ea15464bfe0e4b',
  'd66832b/shared/motion.ts': '003d5eb5914c915c2c80c213e8639ebb781a9e2c',
};

/** The bedca44 legacy-data fixture (not a reader any more): its revision and git blob ids. */
export const LEGACY_FIXTURE = { revision: 'bedca44e18bcdc23f33a4ac887e3f2a57d5d41c8' } as const;
export const LEGACY_FIXTURE_BLOBS: Record<string, string> = {
  'bedca44/server/validation.ts': '0968eaa660a269d31221c9db71ce41dddbe452ff',
  'bedca44/server/photo.ts': 'da2144604b7b71cfa08152f803650a42ec86ddc2',
  'bedca44/shared/widgets.ts': '78ceb54fe1db0b3d5c2b3ab8447dfd82e76fed93',
  'bedca44/shared/defaults.ts': '9cd62547093fc00aa6670566c13707968312f7ef',
  'bedca44/shared/contracts.ts': '1c5805fcb0e997a31df139f0a361936eee4d3fc8',
};

type Kind = 'data' | 'import';
function reader(kind: Kind) { return kind === 'data' ? PREVIOUS_READER.dataSchema : PREVIOUS_READER.importSchema; }

/** Throws with the first Zod issue path when the previous release would reject `value`. */
export function assertPreviousReaderAccepts(kind: Kind, value: unknown, label: string): void {
  const result = reader(kind).safeParse(value);
  if (result.success) return;
  const issue = result.error.issues[0];
  throw new Error(`${label}: the previous release (${PREVIOUS_READER.revision.slice(0, 7)}) rejects this ${kind} at ${issue?.path.join('.') || '(root)'}: ${issue?.message ?? 'invalid'}`);
}

/** Negative control: throws when the previous release would unexpectedly accept `value`. */
export function assertPreviousReaderRejects(kind: Kind, value: unknown, label: string): void {
  if (reader(kind).safeParse(value).success) throw new Error(`${label}: the previous release (${PREVIOUS_READER.revision.slice(0, 7)}) unexpectedly accepts this ${kind}`);
}
