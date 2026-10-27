import { randomBytes } from 'node:crypto';

export const DISPLAY_PRESENCE_MS = 20_000;
/** Presence pauses capture only. It never authorizes pixels or renews safe-desktop observation. */
export class DisplayPresence {
  readonly #views = new Map<string, number>();
  readonly #now: () => number;
  #revision = 0;
  constructor(now: () => number = Date.now) { this.#now = now; }
  get paused() { return this.#views.size > 0; }
  get revision() { return this.#revision; }
  status() { return { paused: this.paused, needsResume: [...this.#views.values()].some(expires => this.#now() >= expires) }; }
  start() {
    if (this.#views.size >= 8) return null;
    if (!this.paused) this.#revision++;
    const id = randomBytes(16).toString('hex'); this.#views.set(id, this.#now() + DISPLAY_PRESENCE_MS);
    return id;
  }
  heartbeat(id: string) {
    const expires = this.#views.get(id);
    if (expires === undefined || this.#now() >= expires) return false;
    this.#views.set(id, this.#now() + DISPLAY_PRESENCE_MS); return true;
  }
  release(id: string) {
    if (!this.#views.delete(id)) return false;
    if (!this.paused) this.#revision++;
    return true;
  }
  /** Explicit user confirmation that every browser display was closed. Never called by a timeout. */
  resume() { if (this.paused) { this.#views.clear(); this.#revision++; } }
}
