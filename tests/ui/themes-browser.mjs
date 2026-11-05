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
import { THEME_PARTICLES_MAX, THEME_SCENE_IDS, THEME_SCENES, THEME_MOTIONS, QUIET_THEME } from '../../src/shared/theme-registry.ts';
import { keepPagesLocal } from './lib/local-only.mjs';
import { mockScreenWakeLock } from './lib/windows-fixture.mjs';
import { waitForNativeRender } from './lib/native-render.mjs';

export async function runThemesQa({ playwright, edge, capture = false } = {}) {
  const started = Date.now(), { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-themes-'));
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true });
  const images=[],checks=[],errors=[],writes=[]; let context,page,source,clock;
  const record = text => { checks.push(text); console.log(`PASS: ${text}`); };
  const saved = () => app.store.snapshot().settings;
  const button = name => page.getByRole('button',{name,exact:true});
  async function open({date='2026-12-20T18:30:00Z',mode='off',code=0,wind=8,reduced='no-preference',animation='subtle',viewport={width:1280,height:720},path='/editor',calendars=['CA','KR','RU'],empty=false,brightness=.36,float=false,swap=false,interval=180,only,birthday}={}) {
    await context?.close(); clock=new Date(date); const settings=defaultSettings(); settings.appearance.theme={mode,calendars}; settings.appearance.motionEnabled=false; settings.appearance.animation=animation;
    settings.appearance.brightness=brightness;
    if(birthday) settings.birthdays=[{id:'00000000-0000-4000-8000-000000000584',name:'Birthday A',date:date.slice(5,10),treatment:birthday}];
    settings.appearance.motionEnabled=float; settings.appearance.rearrange=swap; settings.appearance.motionIntervalSeconds=interval;
    if(empty) { for(const id of Object.keys(settings.widgets)) settings.widgets[id]=false; settings.preview.enabled=false; }
    if(only) { for(const id of Object.keys(settings.widgets)) settings.widgets[id]=only.includes(id); settings.preview.enabled=false; }
    await app.store.update(data=>{data.settings=settings;data.reminders=[];});
    source=await(await fetch(base+'/api/state')).json(); source.weather={...source.weather,status:'fresh',updatedAt:date,error:null,location:settings.location,details:[],daily:[],hourly:[],current:{time:date,temperature:4,feelsLike:2,weatherCode:code,isDay:true,windSpeed:wind}};
    context=await browser.newContext({viewport,timezoneId:'America/Toronto',reducedMotion:reduced}); await keepPagesLocal(context,base); await mockScreenWakeLock(context);
    await context.route('**/api/state',route=>route.fulfill({json:{...source,settings:saved()}}));
    await context.route('**/api/weather',route=>route.fulfill({json:source.weather}));
    page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message)); page.on('request',request=>{if(['PUT','PATCH','POST','DELETE'].includes(request.method()))writes.push(request.url());}); await page.clock.install({time:clock});
    await page.goto(base+path); await page.locator(path==='/editor'?'.studio-header':'.widget-grid-plane').waitFor();
    if(path==='/editor') await page.getByRole('tab',{name:'Style',exact:true}).click();
  }
  async function photo(name) {
    // Seek a synthetic steady instant. Finish widget entrances and sample each mark at its true age.
    await page.clock.runFor(24_000);
    await page.evaluate(()=>document.getAnimations().forEach(a=>{const target=a.effect?.target;if(target instanceof Element&&!target.closest('.ambient-theme')&&a.effect.getTiming().iterations!==Infinity)a.finish();}));
    await page.locator('.theme-mark').evaluateAll(marks=>marks.forEach(mark=>mark.getAnimations().forEach(a=>{a.pause();a.currentTime=Math.max(0,performance.now()-Number(mark.dataset.themeBorn));})));
    if(capture) images.push({name,bytes:await page.screenshot()});
  }
  async function readingIntersections() {
    return page.evaluate(()=>{
      const readings=[],range=document.createRange();
      const walk=node=>{for(const child of node.childNodes) {
        if(child.nodeType===Node.TEXT_NODE&&child.textContent?.trim()) {range.selectNodeContents(child); readings.push(...range.getClientRects());}
        else if(child instanceof Element&&!child.classList.contains('sr-only')) {
          if(child.matches('svg,img,canvas,picture,video,[role="img"]')) readings.push(child.getBoundingClientRect()); else walk(child);
        }
      }};
      document.querySelectorAll('.widget-content').forEach(walk);
      return [...document.querySelectorAll('.theme-mark')].filter(mark=>Number(getComputedStyle(mark).opacity)>.02&&Number(getComputedStyle(mark.parentElement).opacity)>.5).flatMap(mark=>{
        const r=mark.getBoundingClientRect(); return readings.filter(b=>b.width>0&&b.height>0&&r.left<b.right&&r.right>b.left&&r.top<b.bottom&&r.bottom>b.top).map(()=>mark.dataset.themeGeneration);
      });
    });
  }
  try {
    await open(); assert.equal(await page.locator('.ambient-theme').count(),0);
    await waitForNativeRender(page);
    const defaultFit=await page.locator('.inspector-panel').evaluate(panel=>({client:panel.clientHeight,scroll:panel.scrollHeight}));
    assert.ok(defaultFit.scroll<=defaultFit.client+1,`Default Style fits at1280x720: ${JSON.stringify(defaultFit)}`);
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
    await open({date:'2026-11-04T18:30:00Z',mode:'seasonal'});
    await page.locator('.ambient-theme[data-theme-still]').waitFor(); await page.clock.runFor(50);
    assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-motif'),'autumn');
    assert.ok(await page.locator('.theme-mark').count()>0,'ordinary editor visibly represents the current season');
    assert.equal(await page.locator('.ambient-theme').evaluate(layer=>layer.getAnimations({subtree:true}).length),0,'normal preview is still');
    await photo('november4-ordinary-editor');
    await open(); const writeCount=writes.length;
    await page.locator('.theme-try summary').click();
    const sample=page.getByRole('combobox',{name:'Scene preview',exact:true}); await sample.selectOption('christmas');
    await page.clock.runFor(50);
    assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-motif'),'christmas');
    assert.match(await page.locator('.theme-try summary').innerText(),/Preview: Christmas\s+Display unchanged/);
    assert.equal(saved().appearance.theme.mode,'off'); assert.equal(await page.locator('.studio-savebar').count(),0); assert.equal(writes.length,writeCount);
    await sample.selectOption('rain'); assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-motif'),'rain');
    assert.equal(source.weather.current.weatherCode,0,'weather illustration does not change actual weather');
    await button('Return to Automatic').click(); assert.equal(await page.locator('.ambient-theme').count(),0);
    await sample.selectOption('chuseok'); await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('seasonal');
    assert.equal(await sample.inputValue(),'automatic','changing the saved-mode draft clears demonstration');
    await sample.selectOption('seollal'); await button('Cancel').click(); assert.equal(await sample.inputValue(),'automatic');
    await sample.selectOption('autumn'); await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('seasonal');
    await sample.selectOption('seollal'); await page.getByRole('checkbox',{name:'Korea',exact:true}).uncheck(); assert.equal(await sample.inputValue(),'automatic');
    await sample.focus(); await page.keyboard.press('Escape'); assert.equal(await page.locator('.theme-try').getAttribute('open'),null);
    record('November4 shows still autumn immediately; labelled scene demonstrations withThemeOff neither dirty nor write and reset onmode/calendar/Cancel');
    for(const viewport of [{width:1280,height:720},{width:390,height:844},{width:320,height:480},{width:640,height:300}]) {
      await open({mode:'combined',viewport}); const select=page.getByRole('combobox',{name:'Theme',exact:true}); await select.scrollIntoViewIfNeeded();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      const box=await select.boundingBox(); assert.ok(box.height>=44&&box.x>=0&&box.x+box.width<=viewport.width+1);
      const treatment=await select.evaluate(element=>({appearance:getComputedStyle(element).appearance,radius:parseFloat(getComputedStyle(element).borderRadius)}));
      assert.equal(treatment.appearance,'auto');assert.ok(treatment.radius>=12,'Theme uses the established rounded native select treatment');
      await select.focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
      assert.equal(await select.inputValue(),'weather'); await button('Cancel').click(); await select.scrollIntoViewIfNeeded();
      await page.locator('.theme-try summary').scrollIntoViewIfNeeded(); await page.locator('.theme-try summary').click();
      const sample=page.getByRole('combobox',{name:'Scene preview',exact:true}); await sample.selectOption('christmas');
      const previewBox=await sample.boundingBox(); assert.ok(previewBox.height>=44&&previewBox.x>=0&&previewBox.x+previewBox.width<=viewport.width+1);
      if(viewport.width<=700||viewport.height<=520) assert.equal(await page.locator('.theme-try-panel').evaluate(element=>getComputedStyle(element).position),'static','compact chooser follows document flow instead of clipping behind sticky toolbar');
      await sample.scrollIntoViewIfNeeded(); assert.ok(await sample.evaluate(element=>{const r=element.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return hit===element||element.contains(hit);}), 'scene control centre is unobstructed');
      await button('Return to Automatic').scrollIntoViewIfNeeded(); assert.ok(await button('Return to Automatic').isVisible());
      assert.ok((await button('Return to Automatic').boundingBox()).height>=44,'Automatic return keeps a44px target under compact toolbar rules');
      await photo(`theme-editor-${viewport.width}x${viewport.height}`);
    }
    record('Native keyboard selection,44px targets and no horizontal overflow at desktop,phone and short-window sizes');
    const scenes=[
      ['birthday','2026-01-10',0,[], 'classic'],['birthday-russian','2026-01-10',0,[], 'russian'],['birthday-korean','2026-06-12',0,[], 'korean'],
      ['spring','2026-04-25',0],['summer','2026-07-20',0],['autumn','2026-11-04',0],['winter','2026-02-01',0],
      ['christmas','2026-12-20',0],['new-year','2026-12-29',0,['CA','KR']],['new-year-tree','2026-12-29',0],['orthodox-christmas','2027-01-07',0],
      ['halloween','2026-10-25',0],['thanksgiving','2026-10-12',0],['canada-day','2026-07-01',0],['easter','2026-04-05',0,['CA']],
      ['seollal','2027-02-07',0],['chuseok','2027-09-15',0],['lotus-lanterns','2027-05-13',0],['maslenitsa','2026-02-16',0,['RU']],['pascha','2026-04-12',0,['RU']],['mimosa','2026-03-08',0],
      ['rain','2026-12-20',63],['snow','2026-12-20',73],['storm','2026-12-20',95],['fog','2026-12-20',45],['wind','2026-12-20',0],
    ];
    assert.deepEqual(scenes.map(([id])=>id).sort(),[...THEME_SCENE_IDS].sort(),'matrix covers every registered scene');
    const motionsSeen=new Set();
    for(const viewport of [{width:1920,height:1080},{width:3840,height:2160}]) for(const [motif,civil,code,calendars,birthday] of scenes) {
      const definition=THEME_SCENES[motif], mode=definition.group==='Weather'?'weather':'seasonal',origin=definition.group==='Weather'?'weather':definition.group==='Seasons'?'season':definition.group==='Birthdays'?'birthday':'holiday';
      const brightness=viewport.width===1920?.26:.36;
      await open({date:`${civil}T18:30:00Z`,mode,code,calendars,birthday,wind:motif==='wind'?40:8,path:'/display',viewport,brightness}); await page.locator('.ambient-theme').waitFor();
      assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-motif'),motif); assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-source'),origin);
      const geometry=await page.locator('.ambient-theme').evaluate(layer=>({count:layer.querySelectorAll('svg').length,background:getComputedStyle(layer.closest('.ambient')).backgroundColor,filter:getComputedStyle(layer).filter,opacity:Number(getComputedStyle(layer).opacity),marks:[...layer.querySelectorAll('svg')].map(mark=>{const r=mark.getBoundingClientRect();return{width:r.width,height:r.height};})}));
      assert.ok(geometry.count<=THEME_PARTICLES_MAX&&geometry.opacity<=brightness); assert.equal(geometry.background,'rgb(0, 0, 0)'); assert.equal(geometry.filter,'none'); assert.ok(geometry.marks.every(mark=>mark.width<viewport.width*.2&&mark.height<viewport.height*.2));
      await photo(`${motif}-${viewport.width}`);
      const visible=await page.locator('.theme-mark').evaluateAll(marks=>marks.filter(mark=>Number(getComputedStyle(mark).opacity)>.1&&Number(getComputedStyle(mark.parentElement).opacity)>.5).length);
      assert.ok(visible>=3,`${motif} retains at least3 visible placements on the default board (${visible})`);
      assert.deepEqual(await readingIntersections(),[],`${motif} actual steady transforms clear widget ink`);
      const transforms=[];
      for(const age of [2000,5000,8000,11000]) {
        transforms.push(await page.locator('.theme-mark').evaluateAll((marks,age)=>{for(const mark of marks)for(const animation of mark.getAnimations()){animation.pause();animation.currentTime=age;}return marks.map(mark=>({motion:mark.dataset.themeMotion,transform:getComputedStyle(mark).transform}));},age));
        assert.deepEqual(await readingIntersections(),[],`${motif} actual CSS phase${age} clears widget ink`);
      }
      assert.notDeepEqual(transforms[0],transforms[3],`${motif} has actual changing transforms`);
      transforms.flat().forEach(({motion})=>motionsSeen.add(motion));
    }
    assert.deepEqual([...motionsSeen].sort(),Object.keys(THEME_MOTIONS).sort(),'all8 actual motion profiles were phase-sampled');
    for(const code of [0,63]) {
      await open({date:'2026-11-11T18:30:00Z',mode:'combined',code,path:'/display',brightness:.26});await photo(`quiet-${code}`);
      const quiet=await page.locator('.ambient-theme').evaluate(layer=>({quiet:layer.hasAttribute('data-theme-quiet'),count:layer.querySelectorAll('.theme-mark').length,interval:Number(layer.dataset.themeInterval),fills:[...layer.querySelectorAll('.theme-wash')].map(fill=>getComputedStyle(fill).display)}));
      assert.ok(quiet.quiet);assert.ok(quiet.count<=QUIET_THEME.slots);assert.equal(quiet.interval,QUIET_THEME.interval);assert.ok(quiet.fills.every(display=>display==='none'));
    }
    await open({date:'2026-11-11T04:59:40Z',mode:'combined',code:63,path:'/display',empty:true,brightness:.26});
    await page.clock.runFor(18_000); const beforeQuiet=await page.locator('.theme-mark').first().elementHandle();
    assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-quiet'),null);
    await page.clock.runFor(3000);
    assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-quiet'),'true','selected quiet policy takes effect at the local midnight boundary');
    assert.equal(await beforeQuiet.evaluate(mark=>mark.isConnected),false,'quiet policy starts its own lower-travel sequence instead of retaining old rich marks');
    assert.ok(await page.locator('.theme-mark').count()<=QUIET_THEME.slots);
    record('All26 scenes retain richer visible compositions at26%1080p/36%4K with trueblack and reading clearance; quiet dates keep lower density and no fills');
    await open({mode:'seasonal'}); await page.clock.runFor(100); assert.deepEqual(await readingIntersections(),[]);
    await page.getByRole('slider',{name:'Text size',exact:true}).focus(); await page.keyboard.press('End'); await page.clock.runFor(400);
    assert.deepEqual(await readingIntersections(),[],'growing typography invalidates still reading-space placement');
    for(const float of [false,true]) {
      await open({mode:'weather',code:63,path:'/display',viewport:{width:1920,height:1080},float,swap:true,interval:30,only:['clock']});
      await page.clock.runFor(29_900);
      let visibleSamples=0;
      for(let step=0;step<16;step++) {
        await page.clock.runFor(100);
        // Browser CSS time is independent of the fake clock: sample real finite ages explicitly.
        visibleSamples+=await page.locator('.theme-mark').evaluateAll(marks=>{let count=0;for(const mark of marks) {
          for(const animation of mark.getAnimations()) {animation.pause();animation.currentTime=Math.max(0,performance.now()-Number(mark.dataset.themeBorn));}
          if(Number(getComputedStyle(mark).opacity)>.02&&Number(getComputedStyle(mark.parentElement).opacity)>.5)count++;
        }return count;});
        assert.deepEqual(await readingIntersections(),[],`${float?'glide':'pending dim/step'} swap reading clearance at30s+${step/10}`);
      }
      assert.ok(visibleSamples>0,`${float?'glide':'step'} clearance inspected visible CSS marks, not an empty/transparent layer`);
      assert.equal(await page.locator('.ambient').getAttribute('data-composition'),'1','the shortest supported swap completed');
      // Negative control: deliberately place an opaque mark over a clock glyph. The detector must reject it.
      await page.evaluate(()=>{const mark=document.querySelector('.theme-mark'),text=document.querySelector('.ambient-clock svg')??document.querySelector('.clock-date'); const target=text.getBoundingClientRect(),root=mark.closest('.ambient').getBoundingClientRect();mark.style.animation='none';mark.style.opacity='1';mark.parentElement.style.cssText=`left:${target.left-root.left}px;top:${target.top-root.top}px;width:80px;height:80px;opacity:1;transition:none`;});
      assert.ok((await readingIntersections()).length>0,'negative control detects a mark deliberately intersecting clock ink');
    }
    record('Typography growth and30s floating/step swaps retain reading clearance across the pending dim boundary');
    for(const options of [{reduced:'reduce'},{animation:'off'},{mode:'off'}]) { await open({mode:'combined',path:'/display',...options}); assert.equal(await page.locator('.ambient-theme').count(),0); }
    record('Off,AnimationOff and system reduced motion mount no decorative layer');
    await open({mode:'weather',code:63,path:'/display',empty:true}); await page.locator('.theme-mark').first().waitFor();
    assert.equal(await page.locator('.theme-mark').count(),1,'initial atmosphere fades in one mark at a time');
    const firstMark=await page.locator('.theme-mark').first().elementHandle();
    await page.clock.runFor(11_900);
    assert.ok(await firstMark.evaluate(mark=>mark.isConnected),'a visible mark retains its DOM and animation');
    await firstMark.evaluate(mark=>mark.getAnimations().forEach(a=>a.finish()));
    assert.equal(await firstMark.evaluate(mark=>getComputedStyle(mark).opacity),'0');
    await page.clock.runFor(4200);
    assert.equal(await firstMark.evaluate(mark=>mark.isConnected),false,'the first slot renews only after its12s animation has ended');
    const timing=await page.locator('.ambient-theme').evaluate(layer=>layer.getAnimations({subtree:true}).map(a=>({duration:a.effect.getTiming().duration,iterations:a.effect.getTiming().iterations,properties:[...new Set(a.effect.getKeyframes().flatMap(k=>Object.keys(k)))].filter(k=>!['offset','easing','composite','computedOffset'].includes(k))})));
    assert.equal(timing.length,THEME_PARTICLES_MAX); assert.ok(timing.every(t=>t.duration===12000&&t.iterations===1&&t.properties.every(p=>['opacity','transform'].includes(p))));
    await page.locator('.ambient-theme').evaluate(layer=>layer.getAnimations({subtree:true}).forEach(a=>a.finish()));
    assert.ok(await page.locator('.theme-mark').evaluateAll(marks=>marks.every(mark=>getComputedStyle(mark).opacity==='0')));
    record('Staggered finite12s animations touch only transform/opacity and expired slots alone renew with at most12 placements');
    await open({date:'2026-12-20T18:30:55Z',mode:'weather',code:63,path:'/display',empty:true}); await page.locator('.theme-mark').first().waitFor();
    const placement=()=>page.locator('.theme-mark').first().evaluate(mark=>mark.parentElement.getAttribute('style'));
    const lateMount=await placement();
    await page.clock.runFor(5100);
    assert.equal(await placement(),lateMount,'a wall-clock minute never interrupts the initial burst');
    await page.clock.runFor(11_000);
    assert.notEqual(await placement(),lateMount,'the placement renews after its full relative slot lifetime');
    await open({date:'2026-12-20T18:30:55Z',mode:'combined',code:63,empty:true});
    await button('Preview movement').click();
    await page.clock.runFor(15_900);
    await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('seasonal');
    assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-motif'),'christmas');
    await page.locator('.theme-mark').first().waitFor();
    const originalMark=await page.locator('.theme-mark').first().elementHandle();
    const changedMotif=await placement();
    assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-tick'),'0');
    await page.clock.runFor(5100);
    assert.equal(await placement(),changedMotif,'a new motif also gets its full burst across a minute boundary');
    assert.ok(await originalMark.evaluate(mark=>mark.isConnected),'the existing live CSS animation is not replaced by the old deadline');
    await page.emulateMedia({reducedMotion:'reduce'}); await page.locator('.ambient-theme').waitFor({state:'detached'});
    await page.emulateMedia({reducedMotion:'no-preference'}); await page.locator('.theme-mark').first().waitFor(); assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-tick'),'0');
    assert.equal(await page.locator('.theme-mark').count(),1,'resuming motion starts a fresh sequence');
    await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('off');
    await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('combined');
    await page.locator('.theme-mark').first().waitFor();
    assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-tick'),'0');
    assert.equal(await page.locator('.theme-mark').first().evaluate(mark=>getComputedStyle(mark).animationDelay),'0s','new marks fade in from zero');
    record('Near-boundary mount,motif changes and Off/reduced-motion resume keep fresh slot ages and do not cut active marks');
    // Real-time, bounded compositor observation. Synthetic page time stays fixed; no desktop probes.
    await open({mode:'weather',code:63,path:'/display',empty:true}); await page.locator('.theme-mark').first().waitFor();
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
    assert.ok(tickAfter-tickBefore<=4,'the richer1.2s cadence cannot become an uncontrolled renewal loop');
    assert.equal(await page.locator('.theme-mark').count(),THEME_PARTICLES_MAX);
    const activeLayers=layers.length;
    await page.emulateMedia({reducedMotion:'reduce'});
    await new Promise(resolve=>setTimeout(resolve,300)); const quietStart=await metrics(),idlePaintStart=paints; await new Promise(resolve=>setTimeout(resolve,4200)); const idle=await metrics();
    const observed={active:{layout:active.LayoutCount-before.LayoutCount,style:active.RecalcStyleCount-before.RecalcStyleCount,task:active.TaskDuration-before.TaskDuration,paints:activePaints},idle:{layout:idle.LayoutCount-quietStart.LayoutCount,style:idle.RecalcStyleCount-quietStart.RecalcStyleCount,task:idle.TaskDuration-quietStart.TaskDuration,paints:paints-idlePaintStart},layers:activeLayers,peakLayers,slotReplacements:tickAfter-tickBefore};
    console.log(`THEME_BUDGET ${JSON.stringify(observed)}`);
    assert.ok(observed.active.layout<=observed.slotReplacements+1&&observed.idle.layout<=1,'slot replacement, not animation frames, accounts for layout');
    // The previous accepted 4.2s sample allowed15 recalculations for2 renewals.
    // Keep that per-renewal allowance as the intentional cadence becomes faster.
    const checkStyles=(styles,renewals)=>assert.ok(styles<=Math.max(5,Math.ceil(15*renewals/2)), 'style work stays within the baseline allowance per renewal, with at most5 when idle');
    checkStyles(observed.active.style,observed.slotReplacements); checkStyles(observed.idle.style,0);
    assert.ok(observed.active.task<.15&&observed.idle.task<.15,'bounded4.2s window stays below150ms main-thread task work');
    assert.ok(activeLayers>0&&peakLayers<=40,'small nonempty bounded layer tree');
    assert.ok(observed.active.paints<=5&&observed.idle.paints<=5,'no per-frame repainting');
    // Negative control: real per-frame style invalidation in this empty synthetic
    // document must exceed the same idle allowance. Restore it before proceeding.
    const noiseStart=await metrics();
    await page.evaluate(()=>new Promise(resolve=>{const original=document.body.style.color;let frame=0;const step=()=>{document.body.style.color=frame%2?'#010101':'#020202';getComputedStyle(document.body).color;if(++frame<40)requestAnimationFrame(step);else{document.body.style.color=original;resolve();}};requestAnimationFrame(step);}));
    const noisy=await metrics();
    const noisyStyles=noisy.RecalcStyleCount-noiseStart.RecalcStyleCount;
    console.log(`THEME_STYLE_NEGATIVE_CONTROL ${JSON.stringify({frames:40,style:noisyStyles,idleAllowance:5})}`);
    assert.throws(()=>checkStyles(noisyStyles,0), /style work stays within/,'the budget rejects deliberate continuous style work');
    await cdp.detach();
    record('Real4.2s steady active/motion-off samples include slot replacements within layout/style/main-thread and small-layer bounds');
    const lunar=await page.evaluate(()=>{const fmt=new Intl.DateTimeFormat('en-u-ca-dangi',{calendar:'dangi',timeZone:'Asia/Seoul',month:'numeric',day:'numeric'});return ['2027-02-07','2027-05-13','2027-09-15'].map(date=>fmt.formatToParts(new Date(`${date}T12:00:00Z`)).filter(p=>p.type==='month'||p.type==='day').map(p=>p.value));});
    assert.deepEqual(lunar,[['1','1'],['4','8'],['8','15']]); record('Real browser Dangi matches2027 Seollal,Buddha birthday and Chuseok fixtures');
    assert.deepEqual(errors,[]); return {checks,images,seconds:Math.round((Date.now()-started)/1000)};
  } finally {await browser.close();app.server.closeAllConnections();app.server.close();await once(app.server,'close');await rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) { const {values}=parseArgs({options:{playwright:{type:'string'},edge:{type:'string'}}}); const result=await runThemesQa(values);console.log(JSON.stringify({passed:result.checks.length,seconds:result.seconds,checks:result.checks},null,2)); }
