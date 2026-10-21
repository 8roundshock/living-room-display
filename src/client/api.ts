import type { Settings } from '../shared/contracts';

/**
 * Shown whenever the browser cannot reach the local server at all. It names no product (#250):
 * every editor action keeps its draft or form when a request fails this way.
 */
export const NETWORK_ERROR_MESSAGE =
  "Can't reach the display server on this computer. Your changes are kept — try again.";

/**
 * A failed `api()` request. `status` is the HTTP status the server returned, or 0 when no
 * response arrived (the server is stopped or unreachable); `message` is the server's own
 * message, or `NETWORK_ERROR_MESSAGE`. Branch on `status`, never on the message text (#142).
 */
export class ApiError extends Error {
  readonly status: number;
  /** The server's parsed JSON reply, when it sent one; a settings conflict carries the current settings (#287). */
  readonly body: unknown;
  /** The reply's entity tag, when it sent one. */
  readonly etag: string | null;
  constructor(status: number, message: string, options?: ErrorOptions, reply: { body?: unknown; etag?: string | null } = {}) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
    this.body = reply.body ?? null;
    this.etag = reply.etag ?? null;
  }
  /** True when the request never got an answer from the server. */
  get network(): boolean {
    return this.status === 0;
  }
}

export function isNetworkError(value: unknown): boolean {
  return value instanceof ApiError && value.network;
}

/**
 * A caller's own cancellation (its `signal` aborted) is rethrown untouched, so callers that
 * abort superseded requests can still recognise it; every other fetch failure (a `TypeError`,
 * or an abort the caller did not ask for) becomes a network `ApiError` (#232).
 */
function networkFailure(caught: unknown, signal: RequestInit['signal']): never {
  if (signal?.aborted) throw caught;
  throw new ApiError(0, NETWORK_ERROR_MESSAGE, { cause: caught });
}

/** A reply with its entity tag: the settings revision for `/api/state` and `PATCH /api/settings` (#287). */
export interface Tagged<T> {
  body: T;
  etag: string | null;
}

export async function apiTagged<T>(
  path: string,
  options: RequestInit = {},
): Promise<Tagged<T>> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch (caught) {
    networkFailure(caught, options.signal);
  }
  const etag = response.headers.get('ETag');
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    throw new ApiError(
      response.status,
      typeof body?.error === 'string' && body.error
        ? body.error
        : `The local server returned ${response.status}.`,
      undefined,
      { body, etag },
    );
  }
  if (response.status === 204) return { body: undefined as T, etag };
  try {
    return { body: (await response.json()) as T, etag };
  } catch (caught) {
    // The connection dropped while the body was arriving, or the reply was not JSON.
    if (caught instanceof SyntaxError)
      throw new ApiError(response.status, 'The local server sent an unreadable reply. Try again.', { cause: caught });
    networkFailure(caught, options.signal);
  }
}

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  return (await apiTagged<T>(path, options)).body;
}

/**
 * The settings revision (#287) each settings object arrived with, so a Save can send the revision
 * of exactly the settings its changes were computed from. Kept beside the object rather than in it:
 * the revision is API-only and never part of the settings.
 */
const revisions = new WeakMap<object, string>();
export function rememberRevision(settings: object, etag: string | null): void {
  if (etag) revisions.set(settings, etag);
}
export function revisionOf(settings: object): string | null {
  return revisions.get(settings) ?? null;
}

/** A Save refused because another window saved settings first (#287): the current settings and their revision. */
export interface SettingsConflict {
  message: string;
  settings: Settings;
  etag: string;
}
export function settingsConflict(caught: unknown): SettingsConflict | null {
  if (!(caught instanceof ApiError) || caught.status !== 409) return null;
  const body = caught.body as { settings?: unknown; revision?: unknown } | null;
  if (!body || typeof body.settings !== 'object' || body.settings === null || typeof body.revision !== 'string')
    return null;
  return { message: caught.message, settings: body.settings as Settings, etag: caught.etag ?? `"${body.revision}"` };
}
