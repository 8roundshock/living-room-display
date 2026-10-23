import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawn } from 'node:child_process';
import { lstatSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { Settings } from '../shared/contracts.ts';

export const PREPARATION_MAX_AGE_MS = 90_000;
export const PREPARATION_LEAD_SECONDS = 30;
export interface PreparationConfig {
  generation: number; configuration: string; enabled: boolean; parentProcessId: number;
  timeoutSeconds: number; prepareLeadSeconds: number; maxAgeMs: number;
}
export interface PreparationStamp {
  generation: number; configuration: string; inputTick: number; sessionId: number; desktopId: 'Default';
  capturedAt: string; completedAt: string; completedMonotonicMs: number;
}
export interface PreparedImage { content: Buffer; capturedAt: string; width: number; height: number }
export interface PreparationClaim {
  generation: number; configuration: string; processId: number; processStartedAt: string; startedMonotonicMs: number;
  inputTick: number; sessionId: number; desktopId: 'Default';
}
export interface PreparationChild { stop(): void }
export interface PreparationBootstrap { token: string; pipeName: string; parentProcessId: number; port: number; source: string }
export interface PreparationOptions {
  source: string;
  /** Tests supply an inert factory. Ordinary createApplication calls never spawn a worker. */
  start(bootstrap: PreparationBootstrap, exited: () => void): PreparationChild;
}
export interface PreparationView {
  settings: Settings; settingsRevision: string;
  /** Keep the same child/epoch across a scheduled off interval; its capture config still stays disabled. */
  supervisionEnabled?: boolean;
}

/** One unpublished thumbnail. Its byte array is transferred once, or zeroed on every refusal/clear. */
export class PreparedSnapshot {
  #generation = 0;
  #configuration = '';
  #pending: (PreparedImage & PreparationStamp & { receivedAt: number; receivedMonotonic: number }) | null = null;
  #expiry: ReturnType<typeof setTimeout> | null = null;
  readonly #now: () => number;
  readonly #monotonic: () => number;
  constructor(now: () => number = Date.now, monotonic: () => number = () => performance.now()) { this.#now = now; this.#monotonic = monotonic; }
  get generation() { return this.#generation; }
  configure(configuration: string) {
    if (configuration !== this.#configuration) { this.clear(); this.#configuration = configuration; }
  }
  clear() {
    this.#generation++;
    if (this.#expiry) clearTimeout(this.#expiry);
    this.#expiry = null;
    this.#pending?.content.fill(0); this.#pending = null;
  }
  receive(image: PreparedImage, stamp: PreparationStamp, enabled: boolean): boolean {
    const receivedAt = this.#now(), captured = Date.parse(stamp.capturedAt), completed = Date.parse(stamp.completedAt);
    if (!enabled || this.#pending || stamp.generation !== this.#generation || stamp.configuration !== this.#configuration ||
        !Number.isFinite(captured) || !Number.isFinite(completed) || completed < captured || completed > receivedAt ||
        receivedAt - captured > PREPARATION_MAX_AGE_MS || stamp.desktopId !== 'Default') { image.content.fill(0); return false; }
    if (this.#expiry) clearTimeout(this.#expiry);
    this.#pending = { ...image, ...stamp, receivedAt, receivedMonotonic: this.#monotonic() };
    const generation = this.#generation;
    this.#expiry = setTimeout(() => { if (generation === this.#generation) this.clear(); }, Math.max(1, PREPARATION_MAX_AGE_MS - (receivedAt - captured)));
    this.#expiry.unref();
    return true;
  }
  claim(claim: PreparationClaim, enabled: boolean): PreparedImage | null {
    const pending = this.#pending;
    this.#pending = null;
    const started = Date.parse(claim.processStartedAt), current = this.#now();
    const elapsed = pending ? this.#monotonic() - pending.receivedMonotonic : Infinity;
    const valid = enabled && pending && pending.generation === this.#generation && pending.configuration === this.#configuration &&
      claim.generation === pending.generation && claim.configuration === pending.configuration &&
      pending.inputTick === claim.inputTick && pending.sessionId === claim.sessionId && pending.desktopId === claim.desktopId &&
      Number.isSafeInteger(claim.processId) && claim.processId > 0 && pending.completedMonotonicMs + 2_000 < claim.startedMonotonicMs &&
      Number.isFinite(started) && pending.receivedAt < started && Date.parse(pending.completedAt) + 2_000 < started && started <= current &&
      elapsed >= 0 && elapsed <= PREPARATION_MAX_AGE_MS && Math.abs(current - pending.receivedAt - elapsed) <= 2_000 &&
      current - Date.parse(pending.capturedAt) <= PREPARATION_MAX_AGE_MS;
    this.clear();
    if (!valid || !pending) { pending?.content.fill(0); return null; }
    return { content: pending.content, capturedAt: pending.capturedAt, width: pending.width, height: pending.height };
  }
}

/** Owns the random child-only secret and the unpublished image; the UI never receives either. */
export class PreparationController {
  readonly snapshot: PreparedSnapshot;
  #token: string | null = null;
  #pipeName: string | null = null;
  #child: PreparationChild | null = null;
  #attempted = false;
  #closed = false;
  #port: number | null = null;
  #supervise = false;
  readonly #options: PreparationOptions | undefined;
  readonly #view: () => PreparationView;
  readonly #clearActive: () => void;
  constructor(options: PreparationOptions | undefined,
    view: () => PreparationView,
    clearActive: () => void, now: () => number = Date.now, monotonic?: () => number) {
    this.#options = options; this.#view = view; this.#clearActive = clearActive;
    this.snapshot = new PreparedSnapshot(now, monotonic);
  }
  get pipeName() { return this.#child && this.#token ? this.#pipeName : null; }
  config(): PreparationConfig {
    const { settings, settingsRevision, supervisionEnabled } = this.#view();
    this.snapshot.configure(settingsRevision);
    this.#supervise = !this.#closed && !!this.#options && settings.idle.enabled &&
      (supervisionEnabled ?? (settings.preview.enabled && settings.widgets.preview));
    return { generation: this.snapshot.generation, configuration: settingsRevision,
      enabled: this.#supervise && settings.preview.enabled && settings.widgets.preview,
      parentProcessId: process.pid, timeoutSeconds: settings.idle.idleMinutes * 60,
      prepareLeadSeconds: PREPARATION_LEAD_SECONDS, maxAgeMs: PREPARATION_MAX_AGE_MS };
  }
  listening(port: number) { this.#port = port; this.refresh(); }
  refresh() {
    const config = this.config();
    if (!this.#supervise) {
      this.invalidate(this.#child !== null || this.#token !== null); this.#token = null; this.#pipeName = null;
      const child = this.#child; this.#child = null; child?.stop();
      this.#attempted = false; return;
    }
    if (this.#child || this.#attempted || this.#port === null || !this.#options) return;
    this.#attempted = true;
    const token = randomBytes(32).toString('hex'); this.#token = token;
    this.#pipeName = `LivingRoomDisplay.Preview.${randomBytes(16).toString('hex')}`;
    try {
      const child = this.#options.start({ token, pipeName: this.#pipeName, parentProcessId: process.pid, port: this.#port, source: this.#options.source }, () => {
        if (this.#token !== token) return;
        this.#token = null; this.#pipeName = null; this.#child = null; this.invalidate(true);
      });
      if (this.#token === token) this.#child = child; else child.stop();
    } catch { this.#token = null; this.#pipeName = null; this.invalidate(true); }
  }
  authorized(token: unknown): boolean {
    return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) && this.#token !== null &&
      timingSafeEqual(Buffer.from(token), Buffer.from(this.#token));
  }
  invalidate(active = false) { this.snapshot.clear(); if (active) this.#clearActive(); }
  close() {
    this.#closed = true; this.invalidate(true); this.#token = null; this.#pipeName = null;
    const child = this.#child; this.#child = null; child?.stop();
  }
}

/** This gate cannot run a watcher from npm start, a fixture, another Node, or a source checkout. */
export function installedPreparationOptions(input: {
  platform: string; enabledFlag: string | undefined; executable: string; entry: string; dataDirectory: string;
}): PreparationOptions | undefined {
  if (input.platform !== 'win32' || input.enabledFlag !== '1') return undefined;
  const app = resolve(dirname(input.entry), '..', '..'), root = dirname(app);
  const equal = (a: string, b: string) => resolve(a).toLowerCase() === resolve(b).toLowerCase();
  if (basename(app).toLowerCase() !== 'app' || !equal(input.entry, join(app, 'dist', 'server', 'index.js')) ||
      !equal(input.executable, join(root, 'runtime', 'node.exe')) || !equal(input.dataDirectory, join(root, 'data'))) return undefined;
  const helper = join(app, 'windows', 'LivingRoomDisplay.Preview.exe');
  try {
    for (const target of [helper, input.executable, input.entry, input.dataDirectory, join(root, 'installation.json')]) {
      for (let path = resolve(target); ; path = dirname(path)) {
        if (lstatSync(path).isSymbolicLink()) return undefined;
        if (dirname(path) === path) break;
      }
    }
    if (!lstatSync(helper).isFile()) return undefined;
    const marker = JSON.parse(readFileSync(join(root, 'installation.json'), 'utf8')) as Record<string, unknown>;
    if (marker.product !== 'living-room-display' || marker.state !== 'installed' ||
        typeof marker.sourceRevision !== 'string' || !/^[0-9a-f]{40}$/.test(marker.sourceRevision) || marker.sourceState !== 'clean') return undefined;
    return { source: marker.sourceRevision, start(bootstrap, exited) {
      const child = spawn(helper, [], { cwd: app, shell: false, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
      let stopped = false;
      child.once('error', exited); child.once('exit', exited);
      child.stdin.on('error', () => { /* Parent/child shutdown closes the private pipe. */ });
      child.stdin.write(`${JSON.stringify(bootstrap)}\n`);
      return { stop() {
        if (stopped) return; stopped = true;
        child.stdin.end();
        const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); }, 500);
        timer.unref(); child.once('exit', () => clearTimeout(timer));
      } };
    } };
  } catch { return undefined; }
}
