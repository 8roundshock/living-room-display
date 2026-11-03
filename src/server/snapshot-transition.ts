import type { SnapshotFile } from './snapshot-file.ts';

export const SNAPSHOT_TRANSITION_MS = 5_000;
export interface TransitionBinding {
  capability: string; epoch: number; session: number; configuration: string; generation: number; timeout: number;
}
type Episode = TransitionBinding & { phase: 'pending' | 'owned'; fence: number; started: number };
/** Child-only, bounded quarantine. It never grants capture or renews its own deadline. */
export class SnapshotTransition {
  #episode: Episode | null = null;
  #capability = '';
  #highest = 0;
  #mayStart = true;
  #timer: ReturnType<typeof setTimeout> | null = null;
  readonly #file: SnapshotFile;
  readonly #clear: () => void;
  readonly #now: () => number;
  constructor(file: SnapshotFile, clear: () => void, monotonic: () => number = () => performance.now()) {
    this.#file = file; this.#clear = clear; this.#now = monotonic;
  }
  /** Called for every privacy/configuration/producer invalidation, including child exit. */
  invalidate() {
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null; this.#episode = null; this.#mayStart = false;
  }
  #reject() { this.invalidate(); this.#clear(); return false; }
  #scope(capability: string) {
    if (this.#capability === capability) return;
    if (this.#episode) this.#reject();
    this.#capability = capability; this.#highest = 0; this.#mayStart = true;
  }
  #same(a: TransitionBinding, b: TransitionBinding) {
    return a.capability === b.capability && a.epoch === b.epoch && a.session === b.session &&
      a.configuration === b.configuration && a.generation === b.generation && a.timeout === b.timeout;
  }
  check() {
    const episode = this.#episode;
    if (!episode || episode.phase !== 'pending') return;
    const elapsed = this.#now() - episode.started;
    if (elapsed < 0 || elapsed >= SNAPSHOT_TRANSITION_MS) this.#reject();
  }
  desktop() {
    if (this.#episode?.phase === 'pending') this.#reject();
    else this.invalidate();
    this.#mayStart = true;
  }
  stale(capability: string, epoch: number, phase: 'pending' | 'owned') {
    if (capability !== this.#capability) return false;
    return epoch < this.#highest || (epoch === this.#highest &&
      (!this.#episode || (phase === 'pending' && this.#episode.phase === 'owned')));
  }
  pending(binding: TransitionBinding): boolean {
    this.#scope(binding.capability); this.check();
    if (binding.epoch < this.#highest) return false;
    const current = this.#episode;
    if (current && binding.epoch === current.epoch) {
      if (current.phase === 'owned') return false; // A delayed pending message cannot re-hide a revealed epoch.
      return this.#same(current, binding) || this.#reject();
    }
    if (binding.epoch === this.#highest) return false;
    if (!this.#mayStart) { this.#highest = binding.epoch; return this.#reject(); }
    this.#highest = binding.epoch; this.#mayStart = false;
    const episode: Episode = { ...binding, phase: 'pending', fence: this.#file.quarantine(), started: this.#now() };
    this.#episode = episode;
    this.#timer = setTimeout(() => { if (this.#episode === episode && episode.phase === 'pending') this.#reject(); }, SNAPSHOT_TRANSITION_MS);
    this.#timer.unref();
    return true;
  }
  async owned(binding: TransitionBinding, fresh: () => boolean): Promise<boolean> {
    this.#scope(binding.capability); this.check();
    if (binding.epoch < this.#highest) return false;
    const episode = this.#episode;
    if (!episode && binding.epoch <= this.#highest) return false;
    if (!episode || !this.#same(episode, binding)) return this.#reject();
    if (!fresh()) return this.#reject();
    if (episode.phase === 'owned') return true;
    const allowed = () => {
      this.check();
      return this.#episode === episode && this.#same(episode, binding) && fresh();
    };
    const revealed = await this.#file.reveal(episode.fence, allowed);
    if (!revealed || !allowed()) return this.#episode === episode ? this.#reject() : false;
    episode.phase = 'owned';
    if (this.#timer) clearTimeout(this.#timer);
    this.#timer = null;
    return true;
  }
}
