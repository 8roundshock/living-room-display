// Whole-screen atmosphere, isolated source server, synthetic data and RAM-only images.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createApplication } from '../../src/server/app.ts';
import { forecastFixture } from '../../src/server/fixtures.ts';
import { defaultSettings } from '../../src/shared/defaults.ts';
import { keepPagesLocal } from './lib/local-only.mjs';
import { mockScreenWakeLock } from './lib/windows-fixture.mjs';

export async function runThemesQa({ playwright, edge, capture = false } = {}) {
  const started = Date.now(), { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-themes-'));
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const images=[],checks=[],errors=[]; let context,page,source,clock;
  const record = text => { checks.push(text); console.log(`PASS: ${text}`); };
  const saved = () => app.store.snapshot().settings;
  const button = name => page.getByRole('button',{name,exact:true});
  async function open({date='2026-12-20T18:30:00Z',mode='off',code=0,reduced='no-preference',animation='subtle',viewport={width:1280,height:720},path='/editor',calendars=['CA','KR','RU']}={}) {
    await context?.close(); clock=new Date(date); const settings=defaultSettings(); settings.appearance.theme={mode,calendars}; settings.appearance.motionEnabled=false; settings.appearance.animation=animation;
    await app.store.update(data=>{data.settings=settings;data.reminders=[];});
    source=await(await fetch(base+'/api/state')).json(); source.weather={...source.weather,status:'fresh',updatedAt:date,error:null,location:settings.location,details:[],daily:[],hourly:[],current:{time:date,temperature:4,feelsLike:2,weatherCode:code,isDay:true,windSpeed:8}};
    context=await browser.newContext({viewport,timezoneId:'America/Toronto',reducedMotion:reduced}); await keepPagesLocal(context,base); await mockScreenWakeLock(context);
    await context.route('**/api/state',route=>route.fulfill({json:{...source,settings:saved()}}));
    await context.route('**/api/weather',route=>route.fulfill({json:source.weather}));
    page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message)); await page.clock.install({time:clock});
    await page.goto(base+path); await page.locator(path==='/editor'?'.studio-header':'.widget-grid-plane').waitFor();
    if(path==='/editor') await page.getByRole('tab',{name:'Style',exact:true}).click();
  }
  async function photo(name) {
    // Seek a synthetic steady instant. Finish widget entrances and sample each mark at its true age.
    await page.clock.runFor(24_000);
    await page.evaluate(()=>document.getAnimations().forEach(a=>{const target=a.effect?.target;if(target instanceof Element&&!target.closest('.ambient-theme')&&a.effect.getTiming().iterations!==Infinity)a.finish();}));
    await page.locator('.ambient-theme').evaluateAll(layers=>layers.forEach(layer=>layer.querySelectorAll('.theme-mark').forEach(mark=>mark.getAnimations().forEach(a=>{a.pause();a.currentTime=(Number(layer.dataset.themeTick)-Number(mark.dataset.themeGeneration))*Number(layer.dataset.themeInterval)+1000;}))));
    if(capture) images.push({name,bytes:await page.screenshot()});
  }
  try {
    await open(); assert.equal(await page.locator('.ambient-theme').count(),0);
    const choice=page.getByRole('combobox',{name:'Theme',exact:true}); await choice.selectOption('combined');
    await button('Save changes').waitFor(); assert.equal(saved().appearance.theme.mode,'off');
    assert.equal(await page.getByRole('checkbox',{name:'Canada',exact:true}).isChecked(),true);
    await page.getByRole('checkbox',{name:'Russia',exact:true}).uncheck();
    await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({state:'detached'});
    assert.equal(await choice.inputValue(),'off'); assert.equal(saved().appearance.theme.mode,'off');
    await choice.selectOption('combined'); await page.getByRole('checkbox',{name:'Russia',exact:true}).uncheck();
    await button('Save changes').click(); await page.locator('.studio-savebar').waitFor({state:'detached'});
    assert.deepEqual(saved().appearance.theme,{mode:'combined',calendars:['CA','KR']});
    await page.reload(); await page.getByRole('tab',{name:'Style',exact:true}).click(); assert.equal(await choice.inputValue(),'combined');
    record('Theme and calendars are cancellable drafts, save once and survive reload');
    for(const viewport of [{width:1280,height:720},{width:390,height:844},{width:320,height:480},{width:640,height:300}]) {
      await open({mode:'combined',viewport}); const select=page.getByRole('combobox',{name:'Theme',exact:true}); await select.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const box=await select.boundingBox(); assert.ok(box.height>=44&&box.x>=0&&box.x+box.width<=viewport.width+1);
      const treatment=await select.evaluate(element=>({appearance:getComputedStyle(element).appearance,radius:parseFloat(getComputedStyle(element).borderRadius)}));
      assert.equal(treatment.appearance,'auto');assert.ok(treatment.radius>=12,'Theme uses the established rounded native select treatment');
      await select.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
      assert.equal(await select.inputValue(),'weather'); await button('Cancel').click(); await select.scrollIntoViewIfNeeded();
      await photo(`theme-editor-${viewport.width}x${viewport.height}`);
    }
    record('Native keyboard selection,44px targets and no horizontal overflow at desktop,phone and short-window sizes');
    const scenes=[['christmas','2026-12-20T18:30:00Z','seasonal',0,'christmas','holiday'],['rain-christmas','2026-12-20T18:30:00Z','combined',63,'rain','weather'],['quiet-autumn','2026-11-05T18:30:00Z','combined',0,'autumn','season'],['remembrance','2026-11-11T18:30:00Z','seasonal',0,'remembrance','holiday'],['snow','2026-12-20T18:30:00Z','weather',73,'snow','weather'],['fog','2026-12-20T18:30:00Z','weather',45,'fog','weather'],['halloween','2026-10-25T18:30:00Z','seasonal',0,'halloween','holiday']];
    for(const viewport of [{width:1920,height:1080},{width:3840,height:2160}]) for(const [name,date,mode,code,motif,origin] of scenes) {
      await open({date,mode,code,path:'/display',viewport}); await page.locator('.ambient-theme').waitFor();
      assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-motif'),motif); assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-source'),origin);
      const geometry=await page.locator('.ambient-theme').evaluate(layer=>({count:layer.querySelectorAll('svg').length,background:getComputedStyle(layer.closest('.ambient')).backgroundColor,filter:getComputedStyle(layer).filter,opacity:Number(getComputedStyle(layer).opacity),marks:[...layer.querySelectorAll('svg')].map(mark=>{const r=mark.getBoundingClientRect();return{width:r.width,height:r.height};})}));
      assert.ok(geometry.count<=8&&geometry.opacity<=.36); assert.equal(geometry.background,'rgb(0, 0, 0)'); assert.equal(geometry.filter,'none'); assert.ok(geometry.marks.every(mark=>mark.width<viewport.width*.1&&mark.height<viewport.height*.1));
      await photo(`${name}-${viewport.width}`);
    }
    record('Distinct holiday,combined,rain,snow,fog and commemoration scenes keep true black with at most8 small dim marks at1080p/4K');
    for(const options of [{reduced:'reduce'},{animation:'off'},{mode:'off'}]) { await open({mode:'combined',path:'/display',...options}); assert.equal(await page.locator('.ambient-theme').count(),0); }
    record('Off,AnimationOff and system reduced motion mount no decorative layer');
    await open({mode:'weather',code:63,path:'/display'}); await page.locator('.theme-mark').first().waitFor();
    assert.equal(await page.locator('.theme-mark').count(),1,'initial atmosphere fades in one mark at a time');
    const firstMark=await page.locator('.theme-mark').first().elementHandle();
    await page.clock.runFor(11_900);
    assert.ok(await firstMark.evaluate(mark=>mark.isConnected),'a visible mark retains its DOM and animation');
    await firstMark.evaluate(mark=>mark.getAnimations().forEach(a=>a.finish()));
    assert.equal(await firstMark.evaluate(mark=>getComputedStyle(mark).opacity),'0');
    await page.clock.runFor(4200);
    assert.equal(await firstMark.evaluate(mark=>mark.isConnected),false,'the first slot renews only after its12s animation has ended');
    const timing=await page.locator('.ambient-theme').evaluate(layer=>layer.getAnimations({subtree:true}).map(a=>({duration:a.effect.getTiming().duration,iterations:a.effect.getTiming().iterations,properties:[...new Set(a.effect.getKeyframes().flatMap(k=>Object.keys(k)))].filter(k=>!['offset','easing','composite','computedOffset'].includes(k))})));
    assert.equal(timing.length,8); assert.ok(timing.every(t=>t.duration===12000&&t.iterations===1&&t.properties.every(p=>['opacity','transform'].includes(p))));
    await page.locator('.ambient-theme').evaluate(layer=>layer.getAnimations({subtree:true}).forEach(a=>a.finish()));
    assert.ok(await page.locator('.theme-mark').evaluateAll(marks=>marks.every(mark=>getComputedStyle(mark).opacity==='0')));
    record('Staggered finite12s animations touch only transform/opacity and expired slots alone renew with at most8 nodes');
    await open({date:'2026-12-20T18:30:55Z',mode:'weather',code:63,path:'/display'});
    const lateMount=await page.locator('.theme-mark').first().getAttribute('style');
    await page.clock.runFor(5100);
    assert.equal(await page.locator('.theme-mark').first().getAttribute('style'),lateMount,'a wall-clock minute never interrupts the initial burst');
    await page.clock.runFor(11_000);
    assert.notEqual(await page.locator('.theme-mark').first().getAttribute('style'),lateMount,'the placement renews after its full relative minute');
    await open({date:'2026-12-20T18:30:55Z',mode:'combined',code:63});
    await button('Preview movement').click();
    await page.clock.runFor(15_900);
    await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('seasonal');
    assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-motif'),'christmas');
    const originalMark=await page.locator('.theme-mark').first().elementHandle();
    const changedMotif=await page.locator('.theme-mark').first().getAttribute('style');
    assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-tick'),'0');
    await page.clock.runFor(5100);
    assert.equal(await page.locator('.theme-mark').first().getAttribute('style'),changedMotif,'a new motif also gets its full burst across a minute boundary');
    assert.ok(await originalMark.evaluate(mark=>mark.isConnected),'the existing live CSS animation is not replaced by the old deadline');
    await page.emulateMedia({reducedMotion:'reduce'}); await page.locator('.ambient-theme').waitFor({state:'detached'});
    await page.emulateMedia({reducedMotion:'no-preference'}); await page.locator('.ambient-theme').waitFor(); assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-tick'),'0');
    assert.equal(await page.locator('.theme-mark').count(),1,'resuming motion starts a fresh sequence');
    await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('off');
    await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('combined');
    assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-tick'),'0');
    assert.equal(await page.locator('.theme-mark').first().evaluate(mark=>getComputedStyle(mark).animationDelay),'0s','new marks fade in from zero');
    record('Near-boundary mount,motif changes and Off/reduced-motion resume keep fresh slot ages and do not cut active marks');
    // Real-time, bounded compositor observation. Synthetic page time stays fixed; no desktop probes.
    await open({mode:'weather',code:63,path:'/display'}); await page.locator('.theme-mark').first().waitFor();
    await page.clock.runFor(24_000);
    await page.locator('.ambient-theme').evaluate(layer=>layer.querySelectorAll('.theme-mark').forEach(mark=>mark.getAnimations().forEach(a=>{a.currentTime=(Number(layer.dataset.themeTick)-Number(mark.dataset.themeGeneration))*Number(layer.dataset.themeInterval);})));
    const cdp=await context.newCDPSession(page); await cdp.send('Performance.enable');
    let layers=[],peakLayers=0,paints=0; cdp.on('LayerTree.layerTreeDidChange',event=>{layers=event.layers??[];peakLayers=Math.max(peakLayers,layers.length);}); cdp.on('LayerTree.layerPainted',()=>{paints++;}); await cdp.send('LayerTree.enable');
    await new Promise(resolve=>setTimeout(resolve,1500));
    const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item=>[item.name,item.value]));
    const tickBefore=Number(await page.locator('.ambient-theme').getAttribute('data-theme-tick'));
    const before=await metrics(),paintStart=paints; await new Promise(resolve=>setTimeout(resolve,4200)); const active=await metrics(),activePaints=paints-paintStart;
    const tickAfter=Number(await page.locator('.ambient-theme').getAttribute('data-theme-tick'));
    assert.ok(tickAfter-tickBefore>=2,'real-time sample includes at least two recurring slot replacements');
    assert.equal(await page.locator('.theme-mark').count(),8);
    const activeLayers=layers.length;
    await page.emulateMedia({reducedMotion:'reduce'});
    await new Promise(resolve=>setTimeout(resolve,300)); const quietStart=await metrics(),idlePaintStart=paints; await new Promise(resolve=>setTimeout(resolve,4200)); const idle=await metrics();
    const observed={active:{layout:active.LayoutCount-before.LayoutCount,style:active.RecalcStyleCount-before.RecalcStyleCount,task:active.TaskDuration-before.TaskDuration,paints:activePaints},idle:{layout:idle.LayoutCount-quietStart.LayoutCount,style:idle.RecalcStyleCount-quietStart.RecalcStyleCount,task:idle.TaskDuration-quietStart.TaskDuration,paints:paints-idlePaintStart},layers:activeLayers,peakLayers,slotReplacements:tickAfter-tickBefore};
    console.log(`THEME_BUDGET ${JSON.stringify(observed)}`);
    assert.ok(observed.active.layout<=3&&observed.idle.layout<=1,'slot replacement, not animation frames, accounts for layout');
    assert.ok(observed.active.style<=15&&observed.idle.style<=5,'decorative motion does not continually recalculate styles');
    assert.ok(observed.active.task<.15&&observed.idle.task<.15,'bounded4.2s window stays below150ms main-thread task work');
    assert.ok(activeLayers>0&&peakLayers<=40,'small nonempty bounded layer tree');
    assert.ok(observed.active.paints<=5&&observed.idle.paints<=5,'no per-frame repainting'); await cdp.detach();
    record('Real4.2s steady active/motion-off samples include slot replacements within layout/style/main-thread and small-layer bounds');
    const lunar=await page.evaluate(()=>{const fmt=new Intl.DateTimeFormat('en-u-ca-dangi',{calendar:'dangi',timeZone:'Asia/Seoul',month:'numeric',day:'numeric'});return ['2027-02-07','2027-05-13','2027-09-15'].map(date=>fmt.formatToParts(new Date(`${date}T12:00:00Z`)).filter(p=>p.type==='month'||p.type==='day').map(p=>p.value));});
    assert.deepEqual(lunar,[['1','1'],['4','8'],['8','15']]); record('Real browser Dangi matches2027 Seollal,Buddha birthday and Chuseok fixtures');
    assert.deepEqual(errors,[]); return {checks,images,seconds:Math.round((Date.now()-started)/1000)};
  } finally {await browser.close();app.server.closeAllConnections();app.server.close();await once(app.server,'close');await rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) { const {values}=parseArgs({options:{playwright:{type:'string'},edge:{type:'string'}}}); const result=await runThemesQa(values);console.log(JSON.stringify({passed:result.checks.length,seconds:result.seconds,checks:result.checks},null,2)); }
