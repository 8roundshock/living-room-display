/**
 * Test-only frozen reader of the previous installed release (#84 item 2). Never built or shipped:
 * tsconfig.server.json excludes src/server/compat/**.
 *
 * Provenance: ./bedca44/server/{validation,photo}.ts and ./bedca44/shared/{widgets,defaults,contracts}.ts
 * are byte-for-byte copies of those paths at bedca44e18bcdc23f33a4ac887e3f2a57d5d41c8, made with
 * `git show <sha>:<path>`. Never edit them; their relative imports resolve inside the copy and zod
 * resolves from the repository root.
 *
 * Bumping after each coordinated install (#130): vendor the newly installed revision into
 * ./<short-sha>/ with the same `git show` commands, point the imports below,
 * VENDORED_BLOBS (`git ls-tree <sha> <paths>`) and PREVIOUS_RELEASE in ../persistence.ts at it,
 * delete the old copy, and update the rollback
 * table in docs/install.md. Additive defaults that the new baseline accepts can then stop being
 * omitted at rest.
 */
import { dataSchema, importSchema } from './bedca44/server/validation.ts';
import { WIDGET_IDS } from './bedca44/shared/widgets.ts';

export const PREVIOUS_READER = {
  revision: 'bedca44e18bcdc23f33a4ac887e3f2a57d5d41c8',
  dataSchema,
  importSchema,
  widgetIds: [...WIDGET_IDS] as string[],
} as const;

/** Git blob ids of the vendored files at PREVIOUS_READER.revision; rollback.test.ts proves the copy is unedited. */
export const VENDORED_BLOBS: Record<string, string> = {
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
