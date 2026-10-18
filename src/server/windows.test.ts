import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWindowsStatus } from './windows.ts';

test('Windows status reports actual registry flags without changing lock behavior', () => {
  const status = parseWindowsStatus('    SCRNSAVE.EXE    REG_SZ    C:\\Users\\Example\\AppData\\Local\\LivingRoomDisplay\\app\\windows\\LivingRoomDisplay.scr\r\n    ScreenSaveActive    REG_SZ    1\r\n    ScreenSaveTimeOut    REG_SZ    600\r\n    ScreenSaverIsSecure    REG_SZ    1\r\n');
  assert.equal(status.isLivingRoomDisplay, true); assert.equal(status.active, true);
  assert.equal(status.secure, true); assert.equal(status.timeoutSeconds, 600);
  assert.equal(parseWindowsStatus('').active, null);
  assert.equal(parseWindowsStatus('SCRNSAVEXEXE REG_SZ C:\\LivingRoomDisplay.scr').isLivingRoomDisplay, false);
});
