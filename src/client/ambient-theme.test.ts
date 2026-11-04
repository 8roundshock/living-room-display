import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import type { WeatherState, WeatherDetailReading } from '../shared/contracts.ts';
import { resolveTheme, previewTheme, placeThemeMark, themeMotionTimes, themeLocalDate, themeParticle, themeWeatherKind, themeCadence, THEME_ACTIVE_MS, THEME_PARTICLES_MAX } from './ambient-theme.ts';
import { THEME_SCENES, THEME_SCENE_IDS, QUIET_PALETTE } from '../shared/theme-registry.ts';
import { floatPath, stepPath, widgetTrack } from '../shared/float.ts';
const now = new Date('2026-12-20T18:30:00Z');
function fixture() {
  const settings = defaultSettings(); settings.appearance.theme.mode = 'combined';
  const weather: WeatherState = { status: 'fresh', updatedAt: now.toISOString(), error: null, source: 'Open-Meteo', sourceUrl: 'https://open-meteo.com/', location: settings.location,
    units: { temperature: '°C', windSpeed: 'km/h', precipitation: 'mm' }, current: { time: now.toISOString(), temperature: 4, feelsLike: 2, weatherCode: 0, isDay: true, windSpeed: 8 }, daily: [], hourly: [], details: [] };
  return { settings, weather };
}
const detail = (time: string, weatherCode: number | null, windSpeed = 8): WeatherDetailReading => ({ time, weatherCode, windSpeed, temperature: 4, humidity: 50, dewPoint: 1, pressure: 1010, visibility: 10000, cloudCover: 50, windDirection: 20, windGust: 12 });
test('Off is the default; pure Weather has no decorative fallback when quiet', () => {
  const { settings, weather } = fixture(); settings.appearance.theme.mode = 'off'; assert.equal(resolveTheme(settings, weather, now), null);
  settings.appearance.theme.mode = 'weather'; assert.equal(resolveTheme(settings, weather, now), null);
});
test('Combined keeps the holiday while quiet, weather replaces geometry and retains its tint', () => {
  const { settings, weather } = fixture(); const calm = resolveTheme(settings, weather, now, false, '2026-12-20')!;
  assert.equal(calm.motif, 'christmas'); weather.current!.weatherCode = 63;
  const wet = resolveTheme(settings, weather, now, false, '2026-12-20')!;
  assert.equal(wet.motif, 'rain'); assert.equal(wet.tint, calm.tint); assert.equal(wet.source, 'weather'); assert.match(wet.label, /Rain now/);
});
test('Seasonal ignores weather and selected calendars may be empty without losing seasons', () => {
  const { settings, weather } = fixture(); settings.appearance.theme = { mode: 'seasonal', calendars: [] }; weather.current!.weatherCode = 95;
  assert.equal(resolveTheme(settings, weather, now, false, '2026-07-10')?.motif, 'summer');
  settings.location.latitude = -34; assert.equal(resolveTheme(settings, weather, now, false, '2026-07-10')?.motif, 'winter');
});
test('stale, disconnected, aged and different-location weather falls back to seasonal', () => {
  for (const fault of ['stale','offline','aged','wrong-place','future'] as const) {
    const { settings, weather } = fixture(); weather.current!.weatherCode = 95;
    if (fault === 'stale') weather.status = 'stale'; if (fault === 'aged') weather.updatedAt = '2026-12-20T10:00:00Z';
    if (fault === 'wrong-place') weather.location = { ...settings.location, latitude: 0 }; if (fault === 'future') weather.updatedAt = '2026-12-21T18:00:00Z';
    assert.equal(resolveTheme(settings, weather, now, fault === 'offline', '2026-12-20')?.motif, 'christmas', fault);
  }
});
test('forecast scenery uses upcoming hourly instants, never a passed storm or daily worst code', () => {
  const { settings, weather } = fixture(); settings.appearance.theme.mode = 'weather';
  weather.details = [detail('2026-12-20T18:00:00Z',95), detail('2026-12-20T19:00:00Z',71)];
  assert.equal(resolveTheme(settings, weather, now)?.motif, 'snow'); assert.match(resolveTheme(settings, weather, now)!.label, /expected soon/);
  weather.details = [detail('2026-12-20T22:00:00Z',95)]; assert.equal(resolveTheme(settings, weather, now), null);
  weather.details = [detail('invalid',95), detail('2026-12-20T19:00:00Z',999)]; assert.equal(resolveTheme(settings, weather, now), null);
});
test('current-code age is independent of forecast freshness and weather precedence is deterministic', () => {
  const { settings, weather } = fixture(); weather.current!.time = '2026-12-20T14:00:00Z'; weather.current!.weatherCode = 95;
  assert.equal(resolveTheme(settings, weather, now, false, '2026-12-20')?.motif, 'christmas');
  weather.details = [detail('2026-12-20T19:00:00Z',45),detail('2026-12-20T20:00:00Z',95),detail('2026-12-20T19:00:00Z',61)];
  assert.equal(resolveTheme(settings, weather, now)?.motif, 'storm');
});
test('weather motifs distinguish snow, rain, fog and unit-aware wind without flashes', () => {
  assert.equal(themeWeatherKind(77, 0, 'km/h'), 'snow'); assert.equal(themeWeatherKind(56, 0, 'km/h'), 'rain');
  assert.equal(themeWeatherKind(45, 0, 'km/h'), 'fog'); assert.equal(themeWeatherKind(0, 40, 'km/h'), 'wind');
  assert.equal(themeWeatherKind(0, 23, 'mph'), null); assert.equal(themeWeatherKind(0, 24, 'mph'), 'wind');
});
test('holiday lead windows expire and commemorations stay restrained', () => {
  const { settings, weather } = fixture(); settings.appearance.theme.mode='seasonal'; settings.appearance.theme.calendars=['CA'];
  assert.equal(resolveTheme(settings, weather, now, false, '2026-10-25')?.motif, 'halloween');
  assert.equal(resolveTheme(settings, weather, now, false, '2026-11-01')?.motif, 'autumn');
  const quiet = resolveTheme(settings, weather, now, false, '2026-11-11');
  assert.equal(quiet?.motif, 'autumn'); assert.equal(quiet?.quiet, true); assert.equal(quiet?.tint, QUIET_PALETTE[0]);
});
test('gust scenery uses a wholly upcoming preceding-hour interval and unit-aware threshold', () => {
  const {settings,weather}=fixture(); settings.appearance.theme.mode='weather';
  weather.details=[{...detail('2026-12-20T19:00:00Z',0),windGust:70}]; assert.equal(resolveTheme(settings,weather,now),null);
  weather.details=[{...detail('2026-12-20T20:00:00Z',0),windGust:70}]; assert.equal(resolveTheme(settings,weather,now)?.motif,'wind');
  weather.units.windSpeed='mph'; weather.details[0]!.windGust=30; assert.equal(resolveTheme(settings,weather,now),null);
  weather.details[0]!.windGust=31; assert.equal(resolveTheme(settings,weather,now)?.motif,'wind');
});
test('bounded particles vary without randomness and every slot expires before replacement', () => {
  assert.ok(THEME_PARTICLES_MAX <= 8);
  for (const motif of THEME_SCENE_IDS) {
    const {slots,interval}=themeCadence(motif); assert.ok(slots*interval>THEME_ACTIVE_MS); assert.ok(slots<=THEME_PARTICLES_MAX);
  }
  for(let index=0;index<THEME_PARTICLES_MAX;index++) { const a=themeParticle(index,123); assert.deepEqual(a,themeParticle(index,123)); assert.notDeepEqual(a,themeParticle(index,124)); assert.ok(a.x>=3&&a.x<95&&a.y>=3&&a.y<86); }
  assert.equal(themeLocalDate(new Date(2026,0,2,0,1)), '2026-01-02');
});

test('minor civic cards retain the season; selected exact quiet days constrain weather without suppressing it', () => {
  const {settings,weather}=fixture(); settings.appearance.theme.mode='seasonal';
  assert.equal(resolveTheme(settings,weather,now,false,'2026-11-04')?.motif,'autumn');
  assert.equal(resolveTheme(settings,weather,now,false,'2026-11-14')?.motif,'autumn');
  assert.equal(resolveTheme(settings,weather,now,false,'2026-11-15')?.motif,'christmas');
  settings.appearance.theme.mode='combined'; weather.current!.weatherCode=95;
  const scene=resolveTheme(settings,weather,now,false,'2026-11-11')!;
  assert.equal(scene.motif,'storm'); assert.equal(scene.quiet,true); assert.equal(scene.tint,QUIET_PALETTE[0]);
  settings.appearance.theme.calendars=['KR']; assert.equal(resolveTheme(settings,weather,now,false,'2026-11-11')?.quiet,false);
});

test('scene illustrations are complete local registry choices with no implied live forecast', () => {
  for (const id of THEME_SCENE_IDS) {
    const scene=previewTheme(id),definition=THEME_SCENES[id];
    assert.equal(scene.motif,id); assert.equal(scene.forecast,false); assert.equal(scene.holiday,null);
    assert.equal(scene.tint,definition.palette[0]); assert.ok(definition.art.length>0);
  }
});

test('placement respects reading areas and its motion envelope, omitting art when the board is full', () => {
  const exclusions=[{left:0,top:0,right:1000,bottom:780}];
  const spot=placeThemeMark(0,579,1920,1080,151,exclusions)!;
  assert.ok(spot); assert.ok(spot.box.left>=1000||spot.box.top>=780);
  assert.ok(spot.box.left>=0&&spot.box.top>=0&&spot.box.right<=1920&&spot.box.bottom<=1080);
  assert.equal(placeThemeMark(0,579,1920,1080,151,[{left:0,top:0,right:1920,bottom:1080}]),null);
  assert.deepEqual(spot,placeThemeMark(0,579,1920,1080,151,exclusions));
});

test('finite-lifetime motion samples bound every float/step point including the shortest30s boundary', () => {
  for (const interval of [30,180]) for (const seconds of [0,18,29,29.99,30,179]) for (const floating of [true,false]) for (const track of [{lead:0,phase:0},widgetTrack(4)]) {
    const points=themeMotionTimes(seconds,interval,floating?track.phase:0).map(at=>floating?floatPath(at,interval,track):stepPath(at,interval,track));
    const bounds={left:Math.min(...points.map(p=>p.x)),right:Math.max(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y)),bottom:Math.max(...points.map(p=>p.y))};
    for(let offset=0;offset<=12.2;offset+=.07) {
      const point=floating?floatPath(seconds+offset,interval,track):stepPath(seconds+offset,interval,track);
      assert.ok(point.x>=bounds.left-1e-9&&point.x<=bounds.right+1e-9&&point.y>=bounds.top-1e-9&&point.y<=bounds.bottom+1e-9,`${interval}/${seconds}/${floating}: point stays in reserved space`);
    }
  }
});
