/**
 * Test-only frozen reader of the previous installed release (#84 item 2). Never built or shipped:
 * tsconfig.server.json excludes src/server/compat/**.
 *
 * Provenance: ./3fee844/server/{validation,photo,persistence}.ts and
 * ./3fee844/shared/{widgets,defaults,contracts,palette,motion}.ts are byte-for-byte copies of those
 * paths at 3fee844743c6fb469231b348a7c4d2178a887459 (the merge of PR #163, installed on 2026-10-19),
 * made with `git show <sha>:<path>`: its validation.ts and every module it imports, transitively,
 * and nothing else. Never edit them; their relative imports resolve inside the copy and zod resolves
 * from the repository root. .gitattributes exempts src/server/compat/<sha>/ from whitespace checks
 * (#219), so upstream whitespace stays as it is.
 *
 * ./bedca44/ is the earlier reader (bedca44e18bcdc23f33a4ac887e3f2a57d5d41c8, same `git show`
 * copies), kept unedited as a legacy-data fixture: weather-merge.test.ts, native-accent.test.ts and
 * tests/ui/weather-browser.mjs build pre-#74/#75 data from its defaults and grid. It is no longer the
 * rollback reader; LEGACY_FIXTURE_BLOBS proves it stays unedited.
 *
 * Bumping after each coordinated install (#130): vendor the newly installed revision into
 * ./<short-sha>/ with the same `git show` commands, point the imports below,
 * VENDORED_BLOBS (`git ls-tree <sha> <paths>`) and PREVIOUS_RELEASE in ../persistence.ts at it,
 * re-baseline the tests that use the reader, and update the rollback table in docs/install.md.
 * Delete the old copy unless a test still uses it as a fixture (then move its blobs to a fixture
 * constant, as for bedca44). Additive defaults that the new baseline accepts can then stop being
 * omitted at rest.
 */
import { dataSchema, importSchema } from './3fee844/server/validation.ts';
import { WIDGET_IDS } from './3fee844/shared/widgets.ts';

export const PREVIOUS_READER = {
  revision: '3fee844743c6fb469231b348a7c4d2178a887459',
  dataSchema,
  importSchema,
  widgetIds: [...WIDGET_IDS] as string[],
} as const;

/** Git blob ids of the vendored reader at PREVIOUS_READER.revision; rollback.test.ts proves the copy is unedited. */
export const VENDORED_BLOBS: Record<string, string> = {
  '3fee844/server/validation.ts': '3bea9319b15892bd5e0c9f8a801196ce5ee9b898',
  '3fee844/server/photo.ts': 'da2144604b7b71cfa08152f803650a42ec86ddc2',
  '3fee844/server/persistence.ts': '1a989bf5be6ee2a502cca881eb64195820958ded',
  '3fee844/shared/widgets.ts': 'b92da9b56bde235b879a7ecd15f8505b605ed6f3',
  '3fee844/shared/defaults.ts': 'a291e6a6423b61dcd795aae77bb06f036066d21f',
  '3fee844/shared/contracts.ts': '2cdcd4f316921b52591b9cd16019965dce424ede',
  '3fee844/shared/palette.ts': 'a4521a6f58dbd188cc4a22b56ed66d6c44c32fd9',
  '3fee844/shared/motion.ts': '0bd47c05b38daa5182754cf8f995c2ddb91b5867',
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
