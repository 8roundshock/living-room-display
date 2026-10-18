export interface DeviceLocationPlatform {
  permission?: () => Promise<'granted' | 'prompt' | 'denied'>;
  position?: (
    success: (position: {
      coords: { latitude: number; longitude: number };
    }) => void,
    failure: (error: { code: number }) => void,
    options: {
      enableHighAccuracy: boolean;
      timeout: number;
      maximumAge: number;
    },
  ) => void;
}
export type DeviceLocationResult =
  | { status: 'success'; latitude: number; longitude: number }
  | { status: 'permission-needed' | 'denied' | 'unavailable' };

export function browserLocationPlatform(
  browser: Navigator = navigator,
): DeviceLocationPlatform {
  return {
    permission: browser.permissions
      ? async () =>
          (await browser.permissions.query({ name: 'geolocation' })).state
      : undefined,
    position: browser.geolocation
      ? (success, failure, options) =>
          browser.geolocation.getCurrentPosition(success, failure, options)
      : undefined,
  };
}

export async function getDeviceLocation(
  platform: DeviceLocationPlatform,
  allowPrompt: boolean,
): Promise<DeviceLocationResult> {
  if (!platform.position) return { status: 'unavailable' };
  if (!allowPrompt) {
    let permission: 'granted' | 'prompt' | 'denied' | undefined;
    try {
      permission = await platform.permission?.();
    } catch {
      /* Query support varies; never auto-prompt. */
    }
    if (permission !== 'granted')
      return {
        status: permission === 'denied' ? 'denied' : 'permission-needed',
      };
  }
  return new Promise((resolve) => {
    const finish = (result: DeviceLocationResult) => {
      clearTimeout(deadline);
      resolve(result);
    };
    // Some browser services never answer, even after their position timeout.
    const deadline = setTimeout(() => finish({ status: 'unavailable' }), 9000);
    try {
      platform.position!(
        (position) => {
          const { latitude, longitude } = position.coords;
          if (
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 ||
            Math.abs(longitude) > 180
          ) {
            finish({ status: 'unavailable' });
            return;
          }
          // Discard precision, accuracy and timestamps before app HTTP or local settings.
          finish({
            status: 'success',
            latitude: Math.round(latitude * 10) / 10,
            longitude: Math.round(longitude * 10) / 10,
          });
        },
        (error) =>
          finish({ status: error.code === 1 ? 'denied' : 'unavailable' }),
        { enableHighAccuracy: false, timeout: 8000, maximumAge: 15 * 60_000 },
      );
    } catch {
      finish({ status: 'unavailable' });
    }
  });
}
