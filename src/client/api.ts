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
  constructor(status: number, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ApiError';
    this.status = status;
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

export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch (caught) {
    networkFailure(caught, options.signal);
  }
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as {
      error?: unknown;
    } | null;
    throw new ApiError(
      response.status,
      typeof body?.error === 'string' && body.error
        ? body.error
        : `The local server returned ${response.status}.`,
    );
  }
  if (response.status === 204) return undefined as T;
  try {
    return (await response.json()) as T;
  } catch (caught) {
    // The connection dropped while the body was arriving, or the reply was not JSON.
    if (caught instanceof SyntaxError)
      throw new ApiError(response.status, 'The local server sent an unreadable reply. Try again.', { cause: caught });
    networkFailure(caught, options.signal);
  }
}
