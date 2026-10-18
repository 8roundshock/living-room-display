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
 * ./<short-sha>/ with the same `git show` commands, point the imports below and
 * PREVIOUS_RELEASE in ../persistence.ts at it, delete the old copy, and update the rollback
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
