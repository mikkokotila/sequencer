import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const out = new URL('.',import.meta.url).pathname;
const browser=await chromium.launch({headless:false,args:['--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
await page.goto(process.env.QC_URL||'http://127.0.0.1:5173');await page.waitForSelector('html[data-ready="true"]');
await page.evaluate(async()=>{
  const [audio,song,patterns,scheduler,events,store,ui]=await Promise.all(['engine/audio','transport/song','transport/patterns','engine/scheduler','events','engine/extensions/store','ui/build'].map(n=>import(`/src/${n}.ts`)));
  window.q={audio,song,patterns,scheduler,events,store,ui};
  window.soak={starts:[],onsets:[],active:new Set(),maxActive:0,changes:0,stalls:0,clockChecks:[],processorErrors:0};
  const ctx=audio.getAudioContext();window.audioCtx=ctx;
  const start=AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start=function(...a){soak.starts.push({time:a[0]??0,at:ctx.currentTime});soak.active.add(this);soak.maxActive=Math.max(soak.maxActive,soak.active.size);this.addEventListener('ended',()=>soak.active.delete(this),{once:true});return start.apply(this,a);};
  const pulse=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.008),ctx.sampleRate);pulse.getChannelData(0).fill(.02);
  song.drumBuf.fill(pulse);song.melBuf.fill(pulse);song.setVocalBuf(pulse);song.setBpm(220);patterns.octaves.fill(1);
  for(let pi=0;pi<12;pi++){const p=patterns.phrases[pi];p.drumPat.forEach(r=>r.fill(true));p.melPat.forEach(t=>t.forEach(s=>{s.fill(false);s[0]=true;}));p.vocalPat.fill(true);}
  patterns.switchToPhrase(0);ui.refreshUI();ui.updateSongPane();
  const code=`class P extends AudioWorkletProcessor{constructor(){super();this.high=Array(9).fill(false);}process(inputs){const out=[];for(let t=0;t<9;t++){const c=inputs[t][0];if(c)for(let i=0;i<c.length;i++){const h=Math.abs(c[i])>.001;if(h&&!this.high[t])out.push({track:t,frame:currentFrame+i});this.high[t]=h;}}if(out.length)this.port.postMessage(out);return true;}}registerProcessor('soak-tap',P);`;
  const u=URL.createObjectURL(new Blob([code],{type:'text/javascript'}));await ctx.audioWorklet.addModule(u);URL.revokeObjectURL(u);
  const tap=new AudioWorkletNode(ctx,'soak-tap',{numberOfInputs:9,numberOfOutputs:1,outputChannelCount:[1]});audio.getTrackGains().forEach((g,i)=>g.connect(tap,0,i));tap.connect(ctx.destination);tap.port.onmessage=e=>soak.onsets.push(...e.data);tap.onprocessorerror=()=>soak.processorErrors++;
  window.tap=tap;
});
await page.locator('#play-btn').click();
await page.waitForFunction(()=>audioCtx.currentTime>.5);
const cdp=await page.context().newCDPSession(page);
await cdp.send('Performance.enable');await cdp.send('HeapProfiler.collectGarbage');const before=(await cdp.send('Performance.getMetrics')).metrics;
// 180 seconds, 600 control cycles; alternate continuous playback and stop/restart.
for(let batch=0;batch<6;batch++){
  await cdp.send('Emulation.setCPUThrottlingRate',{rate:batch===2||batch===3?4:1});
  await page.evaluate(async batch=>{
    const wait=ms=>new Promise(r=>setTimeout(r,ms));
    for(let i=0;i<100;i++){
      const k=batch*100+i;q.song.setBpm([40,120,220,177][Math.floor(k/10)%4]);q.patterns.switchToPhrase(k%12);
      if(i%10===0){q.scheduler.setPlayingPhrase((k+3)%12);}
      const ext=q.store.SEQ_EXTENSIONS[k%6];ext._enabled=k%2===0;ext.setEnabled?.(ext._enabled);
      if(batch>=4&&i%5===0){q.scheduler.stopPlayback();await wait(40);q.scheduler.togglePlay();}
      if(batch===2&&i%20===0){const until=performance.now()+180;while(performance.now()<until){}soak.stalls++;}
      if(batch===3&&i%25===0){const until=performance.now()+600;while(performance.now()<until){}soak.stalls++;}
      soak.changes++;await wait(300);
    }
    soak.clockChecks.push({batch,time:audioCtx.currentTime,playing:q.scheduler.isPlaying(),active:soak.active.size});
  },batch);
  console.log(`completed batch ${batch+1}/6`);
}
await cdp.send('Emulation.setCPUThrottlingRate',{rate:1});
// Explicit suspend/resume while transport stays active.
await page.evaluate(async()=>{await audioCtx.suspend();await new Promise(r=>setTimeout(r,500));await audioCtx.resume();});
await page.waitForTimeout(1500);await page.locator('#stop-btn').click();await page.waitForTimeout(800);
const r=await page.evaluate(()=>{
  const by=Array.from({length:9},(_,t)=>soak.onsets.filter(e=>e.track===t).map(e=>e.frame));let skew=0;for(let i=0;i<by[0].length;i++)for(let t=1;t<9;t++)skew=Math.max(skew,Math.abs((by[t][i]??Infinity)-by[0][i]));
  return {starts:soak.starts.length,lateStarts:soak.starts.filter(e=>e.time<e.at-1/audioCtx.sampleRate).length,onsetsPerTrack:by.map(x=>x.length),maxSkewSamples:skew,active:soak.active.size,maxActive:soak.maxActive,changes:soak.changes,stalls:soak.stalls,clockChecks:soak.clockChecks,processorErrors:soak.processorErrors,lit:document.querySelectorAll('.playing').length,marked:document.querySelectorAll('.playing-phrase').length,sampleRate:audioCtx.sampleRate};
});
const after=(await cdp.send('Performance.getMetrics')).metrics;
r.errors=errors;r.metricsBefore=before;r.metricsAfter=after;
r.status=r.starts>10000&&r.onsetsPerTrack.every(n=>n>1000)&&r.processorErrors===0&&r.clockChecks.every((p,i)=>i===0||p.time>r.clockChecks[i-1].time)&&r.lateStarts===0&&r.maxSkewSamples<=1&&r.active===0&&r.lit===0&&r.marked===0&&errors.length===0?'PASS':'FAIL';
await writeFile(out+'soak-results.json',JSON.stringify(r,null,2));console.log(JSON.stringify(r));await browser.close();
