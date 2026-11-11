// Whole-screen atmosphere, isolated source server, synthetic data and RAM-only images.
// Edge is launched without WebGL (#600): this suite exercises the flat SVG renderer, which is the supported
// fallback for every scene when WebGL is unavailable and the only renderer for scenes without a 3D module.
// The 3D renderer has its own suite, scene3d-browser.mjs.
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
import { LIVING_SCENE_BUDGET, THEME_SCENE_IDS, THEME_SCENES } from '../../src/shared/theme-registry.ts';
import { PRINCIPAL_FORMS } from '../../src/client/living-scene-principals.ts';
import { keepPagesLocal } from './lib/local-only.mjs';
import { SCENE_CASES, WEBGL_ARGS } from './lib/scene-cases.mjs';
import { mockScreenWakeLock } from './lib/windows-fixture.mjs';
import { waitForNativeRender } from './lib/native-render.mjs';

export async function runThemesQa({ playwright, edge, capture = false } = {}) {
  const started = Date.now(), { chromium } = createRequire(import.meta.url)(playwright ?? 'playwright');
  const directory = await mkdtemp(join(tmpdir(), 'lrd-themes-'));
  const app = await createApplication({ dataDirectory: directory, clientDirectory: fileURLToPath(new URL('../../dist/client', import.meta.url)), fetcher: async () => Response.json(forecastFixture()) });
  app.server.listen(0,'127.0.0.1'); await once(app.server,'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const browser = await chromium.launch({ executablePath: edge, headless: true, args: WEBGL_ARGS.off });
  const images=[],checks=[],errors=[],writes=[]; let context,page,source,clock;
  const record = text => { checks.push(text); console.log(`PASS: ${text}`); };
  const saved = () => app.store.snapshot().settings;
  const button = name => page.getByRole('button',{name,exact:true});
  async function open({date='2026-12-20T18:30:00Z',mode='off',code=0,wind=8,reduced='no-preference',animation='subtle',viewport={width:1280,height:720},path='/editor',calendars=['CA','KR','RU'],empty=false,brightness=.36,float=false,swap=false,interval=180,only,birthday,stableThemeInputs=false,foreground=false}={}) {
    await context?.close(); clock=new Date(date); const settings=defaultSettings(); settings.appearance.theme={mode,calendars,...(foreground?{foreground:true}:{})}; settings.appearance.motionEnabled=false; settings.appearance.animation=animation;
    settings.appearance.brightness=brightness;
    if(birthday) settings.birthdays=[{id:'00000000-0000-4000-8000-000000000584',name:'Birthday A',date:date.slice(5,10),treatment:birthday}];
    settings.appearance.motionEnabled=float; settings.appearance.rearrange=swap; settings.appearance.motionIntervalSeconds=interval;
    if(empty) { for(const id of Object.keys(settings.widgets)) settings.widgets[id]=false; settings.preview.enabled=false; }
    if(only) { for(const id of Object.keys(settings.widgets)) settings.widgets[id]=only.includes(id); settings.preview.enabled=false; }
    await app.store.update(data=>{data.settings=settings;data.reminders=[];});
    source=await(await fetch(base+'/api/state')).json(); source.weather={...source.weather,status:'fresh',updatedAt:date,error:null,location:settings.location,details:[],daily:[],hourly:[],current:{time:date,temperature:4,feelsLike:2,weatherCode:code,isDay:true,windSpeed:wind}};
    context=await browser.newContext({viewport,timezoneId:'America/Toronto',reducedMotion:reduced}); await keepPagesLocal(context,base); await mockScreenWakeLock(context);
    if(stableThemeInputs) await context.addInitScript(()=>{
      // A caller can retain unchanged weather/theme references while replacing personal
      // settings. Preserve those inputs deliberately so a missing memo dependency fails.
      const read=Response.prototype.json; let weather,theme;
      window.syntheticStableThemeReads=0;
      Response.prototype.json=async function(...args){
        const value=await read.apply(this,args);
        if(value?.weather&&value?.settings){
          weather??=value.weather; theme??=value.settings.appearance.theme;
          value.weather=weather; value.settings.appearance.theme=theme; window.syntheticStableThemeReads++;
        }
        return value;
      };
    });
    await context.route('**/api/state',route=>route.fulfill({json:{...source,settings:saved()}}));
    await context.route('**/api/weather',route=>route.fulfill({json:source.weather}));
    page=await context.newPage(); page.on('pageerror',e=>errors.push(e.message)); page.on('request',request=>{if(['PUT','PATCH','POST','DELETE'].includes(request.method()))writes.push(request.url());}); await page.clock.install({time:clock});
    await page.goto(base+path); await page.locator(path==='/editor'?'.studio-header':'.widget-grid-plane').waitFor();
    if(path==='/editor') await page.getByRole('tab',{name:'Style',exact:true}).click();
  }

  /** Finish widget entrances and let the scene observe the settled reading areas. */
  async function settle() {
    await page.clock.runFor(1500);
    await page.evaluate(()=>document.getAnimations().forEach(a=>{const target=a.effect?.target;if(target instanceof Element&&!target.closest('.ambient-theme,.living-foreground')&&a.effect.getTiming().iterations!==Infinity)a.finish();}));
    await page.clock.runFor(4200);
    // Sample every patch inside its steady visible phase; staggered local retreats are checked separately.
    await page.locator('.living-patch, .living-patch-life').evaluateAll(nodes=>nodes.forEach(node=>node.getAnimations().forEach(a=>{a.pause();a.currentTime=(a.effect.getTiming().delay??0)+9000;})));
  }
  async function photo(name) { if(capture) images.push({name,bytes:await page.screenshot()}); }
  /** Pixel proof from one RAM screenshot, so moving widgets cannot desynchronise it.
   * The scene is recoloured pure, fully opaque green; widget ink always carries red or
   * blue. Any ink pixel within two pixels of pure green means art touches a reading. */
  async function artTouchingInk() {
    const style=await page.addStyleTag({content:'.living-theme{opacity:1!important}.living-theme [data-reading-mask] path,.living-theme [data-reading-mask] rect{stroke:#00ff00!important;opacity:1!important}.living-theme [data-reading-mask] path:not([fill="none"]),.living-theme [data-reading-mask] rect{fill:#00ff00!important;fill-opacity:1!important}.living-theme [data-reading-mask] ellipse{fill:#00ff00!important;fill-opacity:1!important;opacity:1!important}.living-theme svg[data-scene-patch],.living-theme .living-patch-life,.living-theme .living-particle-layer,.living-theme .living-rain,.living-theme .living-ripple,.living-theme .living-fog-band,.living-theme .living-gust{opacity:1!important}'});
    // Judge one settled frame: at 4K a headless screenshot can otherwise race the first raster of large
    // animated layers and come back without the scene. Phases are sampled by seeking, not by waiting.
    await page.evaluate(()=>document.querySelector('.living-theme')?.getAnimations({subtree:true}).forEach(a=>a.pause()));
    await waitForNativeRender(page); await page.waitForTimeout(150);
    const shot=(await page.screenshot()).toString('base64');
    await style.evaluate(node=>node.remove());
    return page.evaluate(async base64=>{
      const bitmap=await createImageBitmap(new Blob([Uint8Array.from(atob(base64),character=>character.charCodeAt(0))],{type:'image/png'}));
      const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),context=canvas.getContext('2d'); context.drawImage(bitmap,0,0);
      const {data,width,height}=context.getImageData(0,0,bitmap.width,bitmap.height),green=new Uint8Array(width*height);
      let art=0,lit=0,peak=[0,0,0];
      for(let i=0;i<width*height;i++){const r=data[i*4],g=data[i*4+1],b=data[i*4+2]; if(g>150&&r<40&&b<40){green[i]=1;art++;} if(r+g+b>30){lit++; if(g>peak[1])peak=[r,g,b];}}
      let touching=0;
      for(let y=2;y<height-2;y++) for(let x=2;x<width-2;x++){const i=y*width+x; if(data[i*4]<=24&&data[i*4+2]<=24) continue;
        search: for(let dy=-2;dy<=2;dy++) for(let dx=-2;dx<=2;dx++) if(green[i+dy*width+dx]){touching++;break search;}}
      return {art,touching,lit,peak,size:[width,height]};
    },shot);
  }
  /** A visible, unscaled group must sit wholly outside clearance; the mask is a
   * safety net, not a way to pass off a sheared drawing as a fit. */
  async function fullFormsInReadingSpace() {
    return page.evaluate(()=>{
      const layer=document.querySelector('.living-theme'),origin=layer.getBoundingClientRect();
      const holes=[...layer.querySelectorAll('mask > rect[fill="black"]')].map(hole=>({left:hole.x.baseVal.value,top:hole.y.baseVal.value,right:hole.x.baseVal.value+hole.width.baseVal.value,bottom:hole.y.baseVal.value+hole.height.baseVal.value}));
      return [...layer.querySelectorAll('[data-scene-fit]:not([data-scene-omitted])')].filter(group=>!/scale\((?!1 1\))/.test(group.getAttribute('transform')??'')).flatMap(group=>{
        // Path boxes follow the drawn silhouette more tightly than the conservative control hull.
        const hit=[...group.querySelectorAll('path')].some(path=>{const r=path.getBoundingClientRect(),view=path.closest('svg').getBoundingClientRect();
          const box={left:Math.max(r.left,view.left)-origin.left+2,right:Math.min(r.right,view.right)-origin.left-2,top:Math.max(r.top,view.top)-origin.top+2,bottom:Math.min(r.bottom,view.bottom)-origin.top-2};
          return box.right>box.left&&box.bottom>box.top&&holes.some(hole=>box.left<hole.right&&box.right>hole.left&&box.top<hole.bottom&&box.bottom>hole.top);});
        return hit?[group.dataset.sceneFit]:[];
      });
    });
  }
  try {
    await open(); assert.equal(await page.locator('.ambient-theme').count(),0);
    assert.equal(await page.evaluate(()=>document.createElement('canvas').getContext('webgl2')??document.createElement('canvas').getContext('webgl')),null,'this suite runs without WebGL, on the flat fallback');
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
    await open({date:'2026-11-04T18:30:00Z',mode:'seasonal',path:'/display',stableThemeInputs:true});
    await page.locator('.ambient-theme[data-theme-motif="autumn"]').waitFor();
    await page.clock.runFor(100);
    await app.store.patchSettings({birthdays:[{id:'00000000-0000-4000-8000-000000000584',name:'Birthday A',date:'11-04',treatment:'korean'}]});
    await page.clock.runFor(5000);
    await page.locator('.ambient-theme[data-theme-motif="birthday-korean"]').waitFor({timeout:3000});
    await app.store.patchSettings({birthdays:[]}); await page.clock.runFor(5000);
    await page.locator('.ambient-theme[data-theme-motif="autumn"]').waitFor({timeout:3000});
    assert.ok(await page.evaluate(()=>window.syntheticStableThemeReads>=3),'the display received both updates with stable weather/theme references');
    assert.equal(await page.evaluate(()=>new Date().getUTCMinutes()),30,'both changes render within the same minute');
    record('Adding and clearing today’s birthday updates the existing display at fixed minute with unchanged weather/theme identities');
    await open({date:'2026-11-04T18:30:00Z',mode:'seasonal'});
    await page.locator('.living-theme[data-theme-still]').waitFor(); await page.clock.runFor(50);
    assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-motif'),'autumn');
    assert.ok(await page.locator('[data-scene-fit]:not([data-scene-omitted])').count()>0,'ordinary editor visibly represents the current season');
    assert.equal(await page.locator('.ambient-theme').evaluate(layer=>layer.getAnimations({subtree:true}).length),0,'normal preview is still');
    assert.equal(await page.locator('.living-foreground').count(),0,'the still editor preview has no foreground passage');
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
    for(const motif of ['birthday','birthday-russian','birthday-korean']) {
      await sample.selectOption(motif); assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-motif'),motif);
      assert.equal(saved().birthdays.length,0); assert.equal(await page.locator('.studio-savebar').count(),0); assert.equal(writes.length,writeCount);
    }
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
    await open({mode:'combined'}); await page.locator('.theme-scene-options summary').click();
    const passageOption=page.locator('.theme-passage-option input'); assert.equal(await passageOption.isChecked(),false,'foreground moments default off');
    await passageOption.check(); await button('Save changes').waitFor(); assert.equal(saved().appearance.theme.foreground,undefined);
    await button('Cancel').click(); await page.locator('.studio-savebar').waitFor({state:'detached'}); assert.equal(await page.locator('.theme-passage-option input').isChecked(),false);
    await page.locator('.theme-passage-option input').check(); await button('Save changes').click(); await page.locator('.studio-savebar').waitFor({state:'detached'});
    assert.deepEqual(saved().appearance.theme,{mode:'combined',calendars:['CA','KR','RU'],foreground:true});
    await page.locator('.theme-passage-option input').uncheck(); await button('Save changes').click(); await page.locator('.studio-savebar').waitFor({state:'detached'});
    assert.deepEqual(saved().appearance.theme,{mode:'combined',calendars:['CA','KR','RU']},'turning it off removes the field at rest');
    record('Foreground moments is an opt-in cancellable style draft that is omitted at rest when off');
    const scenes=SCENE_CASES;
    assert.deepEqual(scenes.map(([id])=>id).sort(),[...THEME_SCENE_IDS].sort(),'matrix covers every registered scene');
    const motionsSeen=new Set();
    for(const viewport of [{width:1920,height:1080},{width:3840,height:2160}]) for(const [motif,civil,code,calendars,birthday] of scenes) {
      const definition=THEME_SCENES[motif], mode=definition.group==='Weather'?'weather':'seasonal',origin=definition.group==='Weather'?'weather':definition.group==='Seasons'?'season':definition.group==='Birthdays'?'birthday':'holiday';
      const brightness=viewport.width===1920?.26:.36;
      await open({date:`${civil}T18:30:00Z`,mode,code,calendars,birthday,wind:motif==='wind'?40:8,path:'/display',viewport,brightness}); await page.locator('.living-theme').waitFor(); await settle();
      assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-motif'),motif); assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-source'),origin);
      assert.equal(await page.locator('.ambient-theme').getAttribute('data-scene-renderer'),'flat',`${motif} is drawn by the flat renderer when WebGL is unavailable`); assert.equal(await page.locator('canvas.scene3d-canvas').count(),0);
      const geometry=await page.locator('.living-theme').evaluate(layer=>({patches:layer.querySelectorAll('[data-scene-patch]').length,paths:layer.querySelectorAll('path').length,unmasked:[...layer.querySelectorAll('path')].filter(path=>!path.closest('[data-reading-mask],mask')).length,
        animations:layer.getAnimations({subtree:true}).filter(a=>a.playState==='running').length,background:getComputedStyle(layer.closest('.ambient')).backgroundColor,filter:getComputedStyle(layer).filter,opacity:Number(getComputedStyle(layer).opacity),
        foreground:document.querySelectorAll('.living-foreground').length}));
      assert.ok(geometry.patches>=1&&geometry.patches<=LIVING_SCENE_BUDGET.patches*2,`${motif} patch budget ${geometry.patches}`); assert.ok(geometry.paths<=LIVING_SCENE_BUDGET.paths,`${motif} path budget ${geometry.paths}`);
      assert.ok(geometry.animations<=LIVING_SCENE_BUDGET.animations,`${motif} animation budget ${geometry.animations}`); assert.equal(await page.locator('.living-theme mask rect[fill="black"]').count(),0,'no rectangular reading holes: scenery is translucent, not clipped (#600)');
      assert.ok(geometry.opacity>0&&geometry.opacity<=brightness+.001,`saved brightness bounds the scene and is not raised (${geometry.opacity})`); assert.equal(geometry.background,'rgb(0, 0, 0)'); assert.equal(geometry.filter,'none'); assert.equal(geometry.foreground,0,'no foreground layer unless opted in');
      await photo(`${motif}-${viewport.width}`);
      const forms=await page.locator('.living-theme').evaluate((layer,names)=>names.map(name=>{const group=layer.querySelector(`[data-scene-fit="${name}"]`),box=group?.getBoundingClientRect();
        return {name,present:!!group,omitted:group?.hasAttribute('data-scene-omitted')??true,compact:group?.hasAttribute('data-scene-compact')??false,grass:group?.querySelector('[data-scene-motion]')?.dataset.sceneMotion==='grass',
          onScreen:!!box&&box.width>8&&box.height>8&&box.right>0&&box.bottom>0&&box.left<innerWidth&&box.top<innerHeight,life:Number(getComputedStyle(group?.closest('.living-patch-life')??layer).opacity)};}),PRINCIPAL_FORMS[motif]);
      for(const form of forms) {
        assert.ok(form.present&&!form.omitted&&form.onScreen&&form.life>.9,`${motif} keeps its principal form ${form.name} on the default board at ${viewport.width}: ${JSON.stringify(form)}`);
        if(!form.grass) assert.equal(form.compact,false,`${motif} keeps the complete ${form.name} drawing on the default board at ${viewport.width}`);
      }
      const dress=await page.locator('.living-theme').evaluate(layer=>({ground:Number(layer.querySelector('[data-ground-lit]')?.dataset.groundLit??0),top:layer.querySelectorAll('[data-scene-top]').length,particles:Number(layer.querySelector('[data-particle-count]')?.dataset.particleCount??0),layers:layer.querySelectorAll('.living-particle-layer').length,rain:layer.querySelectorAll('.living-rain path').length,fog:layer.querySelectorAll('ellipse.living-fog-band').length,glows:layer.querySelectorAll('ellipse.living-glow').length,bodies:[...layer.querySelectorAll('[data-scene-patch] path')].map(path=>Number(path.getAttribute('fill-opacity')??0)),tops:layer.querySelectorAll('.living-pendulum,.living-band-top').length}));
      if(motif==='fog') assert.equal(dress.fog,5,'fog is five soft blobs');
      assert.equal(dress.glows,2,`${motif} carries its colour as two faint washes`); assert.equal(await page.locator('.living-theme [data-scene-side]').count(),2,`${motif} frames the board with two side flourishes`); assert.equal(dress.tops,0,`${motif} hangs nothing from the top edge`); assert.ok(dress.bodies.every(value=>value<=.5),`${motif} authored forms are translucent`); assert.ok(geometry.patches<=4,`${motif} shows only its principal patches`);
      assert.ok(dress.ground>=.85,`${motif} lights at least85% of bottom-edge columns on the default board (${dress.ground})`);

      assert.ok(dress.particles>=8||dress.rain>=6||dress.fog>=3,`${motif} keeps particles, rain or fog in the air: ${JSON.stringify(dress)}`);


      // A second phase of the sway and particle cycle keeps the same clearance.


      assert.deepEqual(await fullFormsInReadingSpace(),[],`${motif} complete forms are not sheared by reading space`);
      const transforms=[];
      for(const age of [2000,5000,8000,11000]) transforms.push(await page.locator('.living-attached').evaluateAll((groups,age)=>groups.map(group=>{for(const animation of group.getAnimations()){animation.pause();animation.currentTime=age+(animation.effect.getTiming().delay??0);}return{motion:group.dataset.sceneMotion,transform:getComputedStyle(group).transform};}),age));
      assert.notDeepEqual(transforms[0],transforms[2],`${motif} attached groups actually move`);
      transforms.flat().forEach(({motion})=>motionsSeen.add(motion));
    }
    for(const motion of ['grass','branch','hanging','drift']) assert.ok(motionsSeen.has(motion),`${motion} choreography was phase-sampled`);
    record('All26 living scenes keep their named principal form on the default board at26%1080p/36%4K, trueblack and bounded structure');
    for(const [name,options,expectation] of [['summer rain',{date:'2026-07-20T18:30:00Z',mode:'combined',code:63},{motif:'rain',habitat:'summer',weather:'rain'}],['winter snow',{date:'2026-02-01T18:30:00Z',mode:'combined',code:73},{motif:'snow',habitat:'winter',weather:undefined}],
      // #655: weather a scene's art was not first drawn for used to replace the scene. Now the scene stays under it.
      ['autumn snow',{date:'2026-11-04T18:30:00Z',mode:'combined',code:73},{motif:'snow',habitat:'autumn',weather:undefined}],['christmas storm',{date:'2026-12-20T18:30:00Z',mode:'combined',code:95},{motif:'storm',habitat:'christmas',weather:'storm'}],
      ['weather-only rain',{date:'2026-12-20T18:30:00Z',mode:'weather',code:63},{motif:'rain',habitat:'rain',weather:'rain'}]]) {
      await open({...options,path:'/display',viewport:{width:1920,height:1080},brightness:.26}); await page.locator('.living-theme').waitFor(); await settle();
      const state=await page.locator('.living-theme').evaluate(layer=>({motif:layer.dataset.themeMotif,habitat:layer.dataset.themeHabitat,weather:layer.querySelector('[data-scene-weather]')?.dataset.sceneWeather,particles:layer.querySelector('[data-scene-particles]')?.dataset.sceneParticles,count:Number(layer.querySelector('[data-particle-count]')?.dataset.particleCount??0),rain:layer.querySelectorAll('.living-rain path').length,patches:[...layer.querySelectorAll('[data-scene-patch]')].map(p=>p.dataset.scenePatch)}));
      assert.deepEqual({motif:state.motif,habitat:state.habitat,weather:state.weather},expectation,name);
      if(expectation.motif==='snow') {assert.equal(state.particles,'flake');assert.ok(state.count>=14,'Combined snow is visibly heavier than Winter alone');}
      else {assert.equal(state.particles,undefined,'rain replaces seasonal particles');assert.ok(state.rain>=6,'rain falls in two depths');}
      if(options.mode==='weather') assert.ok(state.patches.every(id=>id.startsWith('rain-')),'Weather mode shows no seasonal or holiday habitat');
      else assert.ok(state.patches.length>0&&state.patches.every(id=>id.startsWith(`${expectation.habitat}-`)),`${name}: Combined keeps the scene's own drawings under the weather: ${state.patches}`);
      await photo(`combined-${name}`);
    }
    record('Combined keeps the season or holiday scene under the weather with one precipitation field, also for snow over Autumn and a storm over Christmas, which replaced the scene before #655; Weather mode stays weather-only');
    for(const code of [0,63]) {
      await open({date:'2026-11-11T18:30:00Z',mode:'combined',code,path:'/display',brightness:.26,birthday:'classic',foreground:true}); await page.locator('.living-theme').waitFor(); await settle(); await photo(`quiet-${code}`);
      const quiet=await page.locator('.living-theme').evaluate(layer=>({quiet:layer.hasAttribute('data-theme-quiet'),patches:layer.querySelectorAll('[data-scene-patch]').length,opacity:Number(getComputedStyle(layer).opacity),brightness:parseFloat(getComputedStyle(layer).getPropertyValue('--ambient-brightness')),drift:layer.querySelectorAll('.living-particle-layer,.living-band,.living-pendulum,.living-glow,.living-side,.living-twinkle').length,
        fills:[...layer.querySelectorAll('[data-scene-patch] path')].filter(path=>path.getAttribute('fill')!=='none').length,birthday:layer.dataset.themeMotif.startsWith('birthday')}));
      assert.ok(quiet.quiet);assert.ok(quiet.patches<=2);assert.equal(quiet.fills,0);assert.equal(quiet.drift,0);assert.equal(quiet.birthday,false);// The page glides to its saved brightness, so compare with the brightness in effect at this instant
      // (a slow runner sampled mid-glide and failed a fixed 26% comparison on 2026-11-10).
      assert.ok(quiet.brightness>0&&quiet.brightness<=.56,`brightness in effect ${quiet.brightness}`); assert.ok(quiet.opacity<=quiet.brightness*.38+.005,`quiet scene is at most38% of brightness: ${quiet.opacity} of ${quiet.brightness}`);
      await page.clock.runFor(80_000); assert.equal(await page.locator('.living-foreground').count(),0,'quiet dates never run a foreground passage');
    }
    await open({date:'2026-11-11T04:59:40Z',mode:'combined',code:63,path:'/display',empty:true,brightness:.26}); await page.locator('.living-theme').waitFor();
    await page.clock.runFor(18_000); assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-quiet'),null);
    await page.clock.runFor(3000);
    assert.equal(await page.locator('.ambient-theme').getAttribute('data-theme-quiet'),'true','selected quiet policy takes effect at the local midnight boundary');
    assert.ok(await page.locator('[data-scene-patch]').count()<=2);
    record('Quiet dates keep a subdued, unfilled, sparse habitat with no drift, birthday geometry or foreground passage');
    record('Scenery is translucent and unclipped: no reading holes, at most two authored forms, three soft washes');
    for(const options of [{reduced:'reduce'},{animation:'off'},{mode:'off'}]) { await open({mode:'combined',path:'/display',foreground:true,...options}); await page.clock.runFor(70_000); assert.equal(await page.locator('.ambient-theme').count(),0); assert.equal(await page.locator('.living-foreground').count(),0); }
    record('Off,AnimationOff and system reduced motion mount no decorative layer and no foreground passage');
    await open({date:'2026-07-20T18:30:00Z',mode:'seasonal',path:'/display',empty:true}); await page.locator('.living-theme').waitFor(); await page.clock.runFor(1000);
    const lifecycle=()=>page.locator('.living-theme').evaluate(layer=>({generations:[...layer.querySelectorAll('[data-scene-patch]:not([data-scene-leaving])')].map(patch=>`${patch.dataset.scenePatch}:${patch.dataset.sceneGeneration}`),drift:layer.querySelectorAll('.living-particle-layer').length,leaving:layer.querySelectorAll('[data-scene-leaving]').length}));
    const first=await lifecycle(); assert.equal(first.drift,4,'particles are four depth layers, not one animation each');
    assert.equal(first.generations.length,THEME_SCENES.summer.composition.patches.filter(patch=>!(patch.depth==='far'&&patch.edge.startsWith('bottom'))).length);
    const timing=await page.locator('.living-theme').evaluate(layer=>layer.getAnimations({subtree:true}).map(a=>({iterations:a.effect.getTiming().iterations,properties:[...new Set(a.effect.getKeyframes().flatMap(k=>Object.keys(k)))].filter(k=>!['offset','easing','composite','computedOffset'].includes(k))})));
    assert.ok(timing.length>0&&timing.length<=LIVING_SCENE_BUDGET.animations); assert.ok(timing.every(t=>Number.isFinite(t.iterations)&&t.properties.every(p=>['opacity','transform'].includes(p))),'every decorative animation is finite and touches only transform/opacity');
    await page.clock.runFor(20_000);
    // Renewal is a cross-fade: while a patch's next generation arrives, the previous one is still drawn.
    let overlap=0,empty=0;
    for(let step=0;step<40;step++) { await page.clock.runFor(1000); const now=await lifecycle(); overlap+=now.leaving; if(now.generations.length<first.generations.length) empty++; }
    assert.ok(overlap>0,'an outgoing generation overlaps the incoming one'); assert.equal(empty,0,'no patch is ever absent during renewal');
    const later=await lifecycle(); assert.notDeepEqual(later.generations,first.generations,'local patches renew by generation');
    assert.equal(later.generations.length,first.generations.length,'renewal replaces patches without accumulating them');
    await page.clock.runFor(LIVING_SCENE_BUDGET.crossfade+4100); assert.equal((await lifecycle()).leaving,0,'outgoing generations are removed after the cross-fade');
    assert.ok(await page.locator('.living-theme').evaluate(layer=>layer.getAnimations({subtree:true}).length)<=LIVING_SCENE_BUDGET.animations,'animations stay bounded after several renewals');
    await page.emulateMedia({reducedMotion:'reduce'}); await page.locator('.ambient-theme').waitFor({state:'detached'});
    await page.emulateMedia({reducedMotion:'no-preference'}); await page.locator('.living-theme').waitFor(); await page.clock.runFor(200);
    assert.ok(Number(await page.locator('.living-theme').getAttribute('data-scene-elapsed'))<5000,'resuming motion starts a fresh scene clock');
    await open({date:'2026-07-20T18:30:55Z',mode:'seasonal',path:'/display',empty:true}); await page.locator('.living-theme').waitFor(); await page.clock.runFor(1000);
    const meadow=await page.locator('[data-scene-patch]').first().elementHandle(), band=await page.locator('.living-band').first().elementHandle();
    await page.clock.runFor(7000);
    assert.ok(await meadow.evaluate(node=>node.isConnected)&&await band.evaluate(node=>node.isConnected),'a wall-clock minute boundary never restarts the scene');
    await open({date:'2026-12-20T18:30:55Z',mode:'combined',code:63,empty:true});
    await button('Preview movement').click(); await page.clock.runFor(9000);
    assert.equal(await page.locator('.living-theme').getAttribute('data-theme-motif'),'rain');
    await page.getByRole('combobox',{name:'Theme',exact:true}).selectOption('seasonal'); await page.clock.runFor(4200);
    assert.equal(await page.locator('.living-theme').getAttribute('data-theme-motif'),'christmas','a theme change during Preview movement shows the new scene');
    assert.ok(Number(await page.locator('.living-theme').getAttribute('data-scene-elapsed'))<9000,'the new scene starts its own clock');
    assert.ok(await page.locator('.living-particle-layer').count()>0&&await page.locator('.living-rain').count()===0);
    record('Finite transform/opacity animations, cross-faded patch renewal, minute-boundary continuity, mid-preview theme change and a fresh scene after reduced-motion resume');
    await open({date:'2026-07-20T18:30:00Z',mode:'seasonal',path:'/display',viewport:{width:1920,height:1080},brightness:.26,foreground:true}); await page.locator('.living-theme').waitFor();
    const passages=[]; let overReading=0,maxOpacity=0;
    for(let tick=0;tick<92;tick++) {
      // CSS fades run on real time while the scene clock is synthetic: let renewed patches finish
      // fading in before the cooldown ends, as they would have long before on a real display.
      if(tick===10||tick===70) await page.waitForTimeout(3600);
      await page.clock.runFor(1000);
      const state=await page.evaluate(()=>{
        const layer=document.querySelector('.living-foreground'),actor=layer?.querySelector('.living-passage'); if(!layer||!actor) return null;
        const a=actor.getBoundingClientRect(),readings=[],range=document.createRange();
        // Graphics count as readings even when aria-hidden (weather glyphs).
        const walk=node=>{for(const child of node.childNodes){if(child.nodeType===Node.TEXT_NODE&&child.textContent?.trim()){range.selectNodeContents(child);readings.push(...range.getClientRects());}else if(child instanceof Element&&!child.classList.contains('sr-only')){if(child.matches('svg,img,canvas,picture,video,[role="img"]'))readings.push(child.getBoundingClientRect());else walk(child);}}};
        document.querySelectorAll('.widget-content').forEach(walk);
        return {born:layer.dataset.passageBorn,kind:layer.dataset.passageKind,opacity:Number(getComputedStyle(layer).opacity),size:[a.width,a.height],glyphs:document.querySelectorAll('.widget-content svg[aria-hidden="true"]').length,forms:actor.querySelectorAll('svg').length,
          over:readings.filter(r=>r.width>0&&r.height>0&&a.left<r.right&&a.right>r.left&&a.top<r.bottom&&a.bottom>r.top).length,layers:document.querySelectorAll('.living-foreground').length};
      });
      if(!state) continue;
      assert.equal(state.layers,1,'one foreground actor at a time');
      if(!passages.some(entry=>entry.born===state.born)) passages.push({born:state.born,kind:state.kind,second:tick});
      maxOpacity=Math.max(maxOpacity,state.opacity); if(state.kind==='near') overReading+=state.over;
      assert.ok(state.opacity<=(state.kind==='near'?.9:.22)*.26+.002,`${state.kind} passage opacity ${state.opacity}`);
      assert.ok(state.size[0]<=1080*.08&&state.size[1]<=1080*.055,'the actor stays a small cluster');
      if(state.kind==='near') assert.ok(state.size[0]>=40&&state.forms>=3,'a near passage is a visible cluster of several forms');
      assert.ok(state.glyphs>0,'the board under test has an aria-hidden weather glyph to protect');
    }
    assert.equal(passages.length,2,`one passage per minute: ${JSON.stringify(passages)}`);
    assert.ok(Number(passages[1].born)-Number(passages[0].born)>=60_000,`at least60s between passage starts: ${JSON.stringify(passages)}`); assert.equal(overReading,0,'a near passage never crosses reading ink');
    await page.mouse.move(400,400); await page.clock.runFor(200);
    console.log(`THEME_PASSAGES ${JSON.stringify({passages,maxOpacity})}`);
    record('Opt-in foreground passage: one visible cluster at a time, at most one per minute, capped opacity and no overlap of text or glyphs');
    // Real-time, bounded compositor observation. Synthetic page time stays fixed; no desktop probes.
    await open({mode:'weather',code:63,path:'/display',empty:true}); await page.locator('.living-theme').waitFor();
    await page.clock.runFor(24_000);
    const cdp=await context.newCDPSession(page); await cdp.send('Performance.enable');
    let layers=[],peakLayers=0,paints=0; cdp.on('LayerTree.layerTreeDidChange',event=>{layers=event.layers??[];peakLayers=Math.max(peakLayers,layers.length);}); cdp.on('LayerTree.layerPainted',()=>{paints++;}); await cdp.send('LayerTree.enable');
    await new Promise(resolve=>setTimeout(resolve,1500));
    const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(item=>[item.name,item.value]));
    const running=await page.locator('.living-theme').evaluate(layer=>layer.getAnimations({subtree:true}).filter(a=>a.playState==='running').length);
    assert.ok(running>0,'the sample observes running scene animations');
    const before=await metrics(),paintStart=paints; await new Promise(resolve=>setTimeout(resolve,4200)); const active=await metrics(),activePaints=paints-paintStart;
    const activeLayers=layers.length;
    await page.emulateMedia({reducedMotion:'reduce'});
    await new Promise(resolve=>setTimeout(resolve,300)); const quietStart=await metrics(),idlePaintStart=paints; await new Promise(resolve=>setTimeout(resolve,4200)); const idle=await metrics();
    const observed={active:{layout:active.LayoutCount-before.LayoutCount,style:active.RecalcStyleCount-before.RecalcStyleCount,task:active.TaskDuration-before.TaskDuration,paints:activePaints},idle:{layout:idle.LayoutCount-quietStart.LayoutCount,style:idle.RecalcStyleCount-quietStart.RecalcStyleCount,task:idle.TaskDuration-quietStart.TaskDuration,paints:paints-idlePaintStart},layers:activeLayers,peakLayers,running};
    console.log(`THEME_BUDGET ${JSON.stringify(observed)}`);
    // Measured for #586: animated SVG groups cost roughly 10-15 style/layout updates a second here
    // (about40-60 per sample), far below one per frame (about250). The ceiling rejects a per-frame loop.
    const checkStyles=(styles,ceiling)=>assert.ok(styles<=ceiling,'style work stays within the measured scene allowance, with at most5 when idle');
    checkStyles(observed.active.style,110); checkStyles(observed.idle.style,5);
    assert.ok(observed.active.layout<=110&&observed.idle.layout<=1,'layout work is bounded while active and absent when motion is off');
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
    assert.throws(()=>checkStyles(noisyStyles,5), /style work stays within/,'the budget rejects deliberate continuous style work');
    await cdp.detach();
    record('Real4.2s active/motion-off samples stay within task, layout/style and small-layer bounds; motion off leaves no scene work');
    const lunar=await page.evaluate(()=>{const fmt=new Intl.DateTimeFormat('en-u-ca-dangi',{calendar:'dangi',timeZone:'Asia/Seoul',month:'numeric',day:'numeric'});return ['2027-02-07','2027-05-13','2027-09-15'].map(date=>fmt.formatToParts(new Date(`${date}T12:00:00Z`)).filter(p=>p.type==='month'||p.type==='day').map(p=>p.value));});
    assert.deepEqual(lunar,[['1','1'],['4','8'],['8','15']]); record('Real browser Dangi matches2027 Seollal,Buddha birthday and Chuseok fixtures');
    assert.deepEqual(errors,[]); return {checks,images,seconds:Math.round((Date.now()-started)/1000)};
  } finally {await browser.close();app.server.closeAllConnections();app.server.close();await once(app.server,'close');await rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) { const {values}=parseArgs({options:{playwright:{type:'string'},edge:{type:'string'}}}); const result=await runThemesQa(values);console.log(JSON.stringify({passed:result.checks.length,seconds:result.seconds,checks:result.checks},null,2)); }
