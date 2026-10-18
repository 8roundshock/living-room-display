/** An untouched local date must not reinterpret an existing saved instant. */
export function reminderDuePatch(
  input: string,
  initialInput: string | undefined,
): { dueAt?: string | null } {
  if (initialInput !== undefined && input === initialInput) return {};
  return { dueAt: input ? new Date(input).toISOString() : null };
}
