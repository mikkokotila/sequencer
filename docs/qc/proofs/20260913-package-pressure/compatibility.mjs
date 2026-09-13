import { chromium, firefox, webkit } from 'playwright';
import { writeFile } from 'node:fs/promises';
const results=[];
for(const [name,type] of Object.entries({chromium,firefox,webkit})){
  if(process.env.QC_BROWSER && name!==process.env.QC_BROWSER)continue;
  let browser;const r={browser:name,status:'PASS',errors:[],checks:{}};
  try{
    browser=await type.launch({headless:true});r.version=browser.version();
    const p=await browser.newPage({viewport:{width:1280,height:900}});p.on('pageerror',e=>r.errors.push(e.message));
    await p.goto('http://127.0.0.1:5173');await p.waitForSelector('html[data-ready="true"]',{timeout:15000});
    const cell=p.locator('.step-cell').first();r.checks.initial=await cell.count();
    await p.evaluate(async()=>{
      const [song,pat,audio]=await Promise.all(['transport/song','transport/patterns','engine/audio'].map(n=>import(`/src/${n}.ts`)));
      window.q={song,pat,audio};const ctx=audio.getAudioContext();const pulse=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.01),ctx.sampleRate);pulse.getChannelData(0).fill(.05);song.drumBuf.fill(pulse);pat.phrases[0].drumPat.forEach(r=>r.fill(true));
      window.started=0;const start=AudioBufferSourceNode.prototype.start;AudioBufferSourceNode.prototype.start=function(...a){window.started++;return start.apply(this,a);};
    });
    await p.locator('#play-btn').click();await p.waitForTimeout(2000);r.checks.afterClick=await p.evaluate(()=>({started,state:q.audio.getAudioContext().state,time:q.audio.getAudioContext().currentTime}));await p.waitForFunction(()=>started>=20,{},{timeout:10000,polling:100});await p.locator('#stop-btn').click();
    r.checks.playback=await p.evaluate(()=>({started,time:q.audio.getAudioContext().currentTime,playing:document.querySelectorAll('.playing').length,marked:document.querySelectorAll('.playing-phrase').length}));
    await p.evaluate(async()=>{const persistence=await import('/src/transport/persistence.ts');q.pat.setDrumStep(0,63,true);await persistence.saveSong();});
    await p.reload();await p.waitForSelector('html[data-ready="true"]');r.checks.reload=await p.evaluate(async()=>{const m=await import('/src/transport/patterns.ts');return m.drumPat[0][63];});
    for(const width of [1440,768,390]){
      await p.setViewportSize({width,height:900});await p.screenshot({path:new URL(`${name}-${width}.png`,import.meta.url).pathname,fullPage:false});
      r.checks['layout'+width]=await p.evaluate(()=>({viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,transportWidth:document.querySelector('#transport')?.getBoundingClientRect().width,play:document.querySelector('#play-btn').getBoundingClientRect().toJSON()}));
    }
    if(!r.checks.reload||r.errors.length)r.status='FAIL';
  }catch(e){r.status='FAIL';r.failure=e.message;}
  results.push(r);console.log(JSON.stringify(r));if(browser)await Promise.race([browser.close(),new Promise(r=>setTimeout(r,2500))]);
}
await writeFile(new URL(process.env.QC_BROWSER?'compatibility-recheck-results.json':'compatibility-results.json',import.meta.url),JSON.stringify(results,null,2));

process.exit(0);
