import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings } from '../shared/defaults.ts';
import { defaultTheme } from '../shared/themes.ts';
import { needsForecast } from '../shared/widgets.ts';
import { settingsSchema, settingsPatchSchema, mergeSettings } from './validation.ts';
import { persistableSettings } from './persistence.ts';
import { settingsChanges, rebaseSettings } from '../client/draft.ts';
import { getVisual } from '../client/model.ts';
import { assertPreviousReaderAccepts, assertPreviousReaderRejects } from './compat/previous-reader.ts';
const wrap = (settings: unknown) => ({ version:1,settings,reminders:[],photoAsset:null });
test('missing/default themes migrate and remain readable by the frozen previous reader',()=>{
  const base=defaultSettings(), written=persistableSettings(base) as any;
  assert.equal(written.appearance.theme,undefined); assert.equal(written.widgetData?.dynamic?.holidays,undefined);
  assert.deepEqual(settingsSchema.parse(written).appearance.theme,defaultTheme());
  assertPreviousReaderAccepts('data',wrap(written),'default theme omitted');
  base.widgetData.dynamic.sky=false;
  assert.equal((persistableSettings(base) as any).widgetData.dynamic.holidays,undefined,'false key is omitted even for a custom Dynamic source selection');
  assert.equal(settingsSchema.parse(persistableSettings(base)).widgetData.dynamic.holidays,false);
});
test('theme edits roundtrip through saved styles, imports, patch and explicit rollback exception',()=>{
  const base=defaultSettings(), changed=mergeSettings(base,{appearance:{theme:{mode:'combined',calendars:['KR']}}});
  changed.savedPresets=[{id:'seasonal',name:'Evening',visual:getVisual(changed)}];
  const written=persistableSettings(changed); assert.deepEqual(settingsSchema.parse(written),changed);
  assertPreviousReaderRejects('data',wrap(written),'enabled theme is documented exception');
  const patch=settingsChanges(base,changed); assert.deepEqual(patch.appearance?.theme,{mode:'combined',calendars:['KR']});
  assert.doesNotThrow(()=>settingsPatchSchema.parse(patch));
});
test('theme patch is complete and concurrent unrelated settings survive rebase',()=>{
  const base=defaultSettings(), draft=structuredClone(base); draft.appearance.theme.mode='weather';
  assert.deepEqual(settingsChanges(base,draft).appearance?.theme,{mode:'weather',calendars:['CA','KR','RU']});
  const incoming=structuredClone(base); incoming.clockFormat='24h';
  const rebased=rebaseSettings(base,draft,incoming); assert.equal(rebased.clockFormat,'24h'); assert.equal(rebased.appearance.theme.mode,'weather');
  assert.equal(settingsPatchSchema.safeParse({appearance:{theme:{mode:'weather'}}}).success,false);
  assert.equal(settingsPatchSchema.safeParse({appearance:{theme:{mode:'combined',calendars:['CA','CA']}}}).success,false);
});
test('weather theme requests forecast even when every widget is off',()=>{
  const settings=defaultSettings(); for(const id of Object.keys(settings.widgets)) settings.widgets[id as keyof typeof settings.widgets]=false;
  assert.equal(needsForecast(settings),false); settings.appearance.theme.mode='combined'; assert.equal(needsForecast(settings),true);
  settings.appearance.theme.mode='seasonal'; assert.equal(needsForecast(settings),false);
});
