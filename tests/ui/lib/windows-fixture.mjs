/** UI navigation suites use synthetic device facts, never the host's registry or power settings. */
export async function mockWindowsStatus(context) {
  await context.route('**/api/windows/status', route => route.fulfill({ json: {
    available: false, selectedScreenSaver: null, active: null, timeoutSeconds: null,
    secure: null, isLivingRoomDisplay: false,
    power: { available: false, scheme: null, displayOffSeconds: null, sleepSeconds: null },
  } }));
}
