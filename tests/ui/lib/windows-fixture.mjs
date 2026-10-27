/** UI navigation suites use synthetic device facts, never the host's registry or power settings. */
export async function mockWindowsStatus(context) {
  await context.route('**/api/windows/status', route => route.fulfill({ json: {
    available: false, selectedScreenSaver: null, active: null, timeoutSeconds: null,
    secure: null, isLivingRoomDisplay: false,
    power: { available: false, scheme: null, displayOffSeconds: null, sleepSeconds: null },
  } }));
}

/** Presentation suites never acquire a real screen wake lock. */
export async function mockScreenWakeLock(context) {
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
      const sentinel = new EventTarget(); sentinel.released = false;
      sentinel.release = async () => { if (sentinel.released) return; sentinel.released = true; sentinel.dispatchEvent(new Event('release')); };
      return sentinel;
    } } });
  });
}
