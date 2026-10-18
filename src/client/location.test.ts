import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { getDeviceLocation, type DeviceLocationPlatform } from './location.ts';

test('automatic location never requests a position without an already-granted permission', async () => {
  for (const permission of ['prompt', 'denied'] as const) {
    let calls = 0;
    const result = await getDeviceLocation(
      {
        permission: async () => permission,
        position: () => {
          calls++;
        },
      },
      false,
    );
    assert.equal(calls, 0);
    assert.equal(
      result.status,
      permission === 'denied' ? 'denied' : 'permission-needed',
    );
  }
  assert.equal(
    (
      await getDeviceLocation(
        {
          position: () =>
            assert.fail('No Permissions API must not auto-prompt'),
        },
        false,
      )
    ).status,
    'permission-needed',
  );
  assert.equal(
    (
      await getDeviceLocation(
        {
          permission: async () => {
            throw new Error('unsupported');
          },
          position: () =>
            assert.fail('Failed permission query must not auto-prompt'),
        },
        false,
      )
    ).status,
    'permission-needed',
  );
});

test('an unresponsive device service times out and ignores a later result', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let lateSuccess:
    | Parameters<NonNullable<DeviceLocationPlatform['position']>>[0]
    | undefined;
  const result = getDeviceLocation(
    {
      position: (success) => {
        lateSuccess = success;
      },
    },
    true,
  );
  t.mock.timers.tick(10_000);
  assert.deepEqual(await result, { status: 'unavailable' });
  lateSuccess!({ coords: { latitude: 1, longitude: 2 } });
  assert.deepEqual(await result, { status: 'unavailable' });
});

test('granted permission makes one low-accuracy lookup and returns only rounded coordinates', async () => {
  let calls = 0;
  const platform: DeviceLocationPlatform = {
    permission: async () => 'granted',
    position: (success, _failure, options) => {
      calls++;
      assert.equal(options.enableHighAccuracy, false);
      assert.equal(options.timeout, 8000);
      assert.equal(options.maximumAge, 900_000);
      success({ coords: { latitude: 12.34567, longitude: 45.67891 } });
    },
  };
  assert.deepEqual(await getDeviceLocation(platform, false), {
    status: 'success',
    latitude: 12.3,
    longitude: 45.7,
  });
  assert.equal(calls, 1);
});

test('a user-gesture lookup works without Permissions API and handles denial/unavailability', async () => {
  assert.equal(
    (
      await getDeviceLocation(
        { position: (_success, failure) => failure({ code: 1 }) },
        true,
      )
    ).status,
    'denied',
  );
  assert.equal(
    (
      await getDeviceLocation(
        { position: (_success, failure) => failure({ code: 2 }) },
        true,
      )
    ).status,
    'unavailable',
  );
  assert.equal((await getDeviceLocation({}, true)).status, 'unavailable');
  assert.equal(
    (
      await getDeviceLocation(
        {
          position: () => {
            throw new Error('mock');
          },
        },
        true,
      )
    ).status,
    'unavailable',
  );
});

test('invalid coordinates never leave the location adapter', async () => {
  for (const latitude of [NaN, Infinity, 91]) {
    assert.deepEqual(
      await getDeviceLocation(
        {
          position: (success) =>
            success({ coords: { latitude, longitude: 0 } }),
        },
        true,
      ),
      { status: 'unavailable' },
    );
  }
  assert.deepEqual(
    await getDeviceLocation(
      {
        position: (success) =>
          success({ coords: { latitude: 0, longitude: -181 } }),
      },
      true,
    ),
    { status: 'unavailable' },
  );
});
