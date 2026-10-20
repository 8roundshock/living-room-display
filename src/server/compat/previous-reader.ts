/**
 * Test-only frozen reader of the previous installed release (#84 item 2). Never built or shipped:
 * tsconfig.server.json excludes src/server/compat/**.
 *
 * Provenance: ./3446400/server/{validation,photo,persistence}.ts and
 * ./3446400/shared/{widgets,defaults,contracts,palette,motion}.ts are byte-for-byte copies of those
 * paths at 34464001af41af0e2ea67fb090734b296f72c1c2 (the merge of PR #286, installed on 2026-10-19),
 * made with `git show <sha>:<path>`: its validation.ts and every module it imports, transitively,
 * and nothing else. Never edit them; their relative imports resolve inside the copy and zod resolves
 * from the repository root. .gitattributes exempts src/server/compat/<sha>/ from whitespace checks
 * (#219), so upstream whitespace stays as it is. The installed 3446400 keeps 4cb7dc1 (PR #327) as
 * app.previous; `git ls-tree` gives 4cb7dc1 the same eight blobs, so this copy is its reader too.
 * Until #367 the reader was 3fee844's (#263, PR #278); npm test at 3446400 proved that 3fee844
 * reads what 3446400 writes.
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
import { dataSchema, importSchema } from './3446400/server/validation.ts';
import { WIDGET_IDS } from './3446400/shared/widgets.ts';

export const PREVIOUS_READER = {
  revision: '34464001af41af0e2ea67fb090734b296f72c1c2',
  dataSchema,
  importSchema,
  widgetIds: [...WIDGET_IDS] as string[],
} as const;

/** Git blob ids of the vendored reader at PREVIOUS_READER.revision; rollback.test.ts proves the copy is unedited. */
export const VENDORED_BLOBS: Record<string, string> = {
  '3446400/server/validation.ts': '0effea25374bdc684e3fc7cee3cdecb7be8bc578',
  '3446400/server/photo.ts': 'f90dfd9900bbf3beeaa4b6a8647ad58e08b5a2d4',
  '3446400/server/persistence.ts': 'c587827a0369072d8cc40f5b01e80554a83ee733',
  '3446400/shared/widgets.ts': '50f2415ad5bec2d49bbaa91e368c768b9d017a7e',
  '3446400/shared/defaults.ts': 'a291e6a6423b61dcd795aae77bb06f036066d21f',
  '3446400/shared/contracts.ts': '2cdcd4f316921b52591b9cd16019965dce424ede',
  '3446400/shared/palette.ts': '904260564bb4f4c9282b152ee78c100327ef1bef',
  '3446400/shared/motion.ts': '0bd47c05b38daa5182754cf8f995c2ddb91b5867',
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
