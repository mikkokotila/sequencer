import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require = createRequire(path.join(process.env.SEQUENCER_ROOT || process.cwd(), 'package.json'));
const { chromium } = require('playwright');
const out = process.env.AUDIT_OUTPUT || path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch({headless:false});
const results = [];
const configs = [
 {name:'40-bpm-boundaries', bpm:40, duration:50000},
 {name:'120-bpm-boundaries', bpm:120, duration:26000},
 {name:'220-bpm-dense', bpm:220, duration:26000, poly:true},
 {name:'220-bpm-cpu4x-edits', bpm:220, duration:18000, cpu:4, edit:true, stall:40},
 {name:'220-bpm-180ms-stalls', bpm:220, duration:15000, stall:180},
 {name:'tempo-sweep-restarts', bpm:120, duration:15000, cycles:true},
];
if (process.env.SCENARIO) configs.splice(0, configs.length, ...configs.filter(c=>c.name.includes(process.env.SCENARIO)));
try {
for (const cfg of configs) {
 console.log('BEGIN '+cfg.name);
 const context = await browser.newContext({viewport:{width:1440,height:1000}});
 const page = await context.newPage();
 const errors = [];
 page.on('pageerror', e => errors.push(e.message));
 await page.addInitScript(() => {
  const Orig = window.AudioContext;
  window.__ctxs = [];
  window.AudioContext = class extends Orig {constructor(...args){super(...args); window.__ctxs.push(this);}};
  window.__audit = {starts:[],triggers:[],visuals:[],markers:[],onsets:[],stops:[],actions:[],alive:new Set(),buffers:new WeakMap(),epoch:0};
  const originalStart = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function(...args) {
   const a=window.__audit;
   a.starts.push({time:args[0]||0,at:this.context.currentTime,track:a.buffers.get(this.buffer),epoch:a.epoch});
   a.alive.add(this); this.addEventListener('ended',()=>a.alive.delete(this),{once:true});
   return originalStart.apply(this,args);
  };
 });
 await page.goto('http://127.0.0.1:5173/');
 await page.waitForFunction(()=>window.__SEQ_EVENT_BUS__ && document.querySelector('.adsr-btn') && document.querySelector('.ext-icon-btn'));
 await page.waitForTimeout(700);
 console.log('READY '+cfg.name);
 await page.click('#app');
 await page.evaluate(async cfg=>{
  const [audio,patterns,song,adsr,scheduler,build,store] = await Promise.all([
   import('/src/engine/audio.ts'),import('/src/transport/patterns.ts'),import('/src/transport/song.ts'),import('/src/engine/adsr.ts'),import('/src/engine/scheduler.ts'),import('/src/ui/build.ts'),import('/src/engine/extensions/store.ts')]);
  const ctx=audio.getAudioContext(); await Promise.race([ctx.resume(),new Promise((_,reject)=>setTimeout(()=>reject(new Error('AudioContext resume timed out; state='+ctx.state)),5000))]);
  const a=window.__audit;
  Object.assign(a,{ctx,patterns,song,scheduler,build,store});
  song.setBpm(cfg.bpm);
  for(let i=0;i<12;i++) patterns.phrases[i]=patterns.makeEmptyPhrase();
  for(const p of [0,1,3]){
   const phrase=patterns.phrases[p];
   phrase.drumPat.forEach(r=>r.fill(true)); phrase.vocalPat.fill(true);
   phrase.melPat.forEach((track,t)=>track.forEach(step=>{step[0]=true;if(cfg.poly&&t>0){step[4]=true;step[7]=true;step[11]=true;}}));
  }
  patterns.octaves.fill(1);
  for(let t=0;t<9;t++){
   const buf=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*0.008),ctx.sampleRate);
   buf.getChannelData(0).fill(0.02); a.buffers.set(buf,t);
   if(t<5)song.drumBuf[t]=buf;else if(t<8)song.melBuf[t-5]=buf;else song.setVocalBuf(buf);
  }
  patterns.switchToPhrase(0); build.refreshUI(); build.updateSongPane();
  const processor=`class OnsetAudit extends AudioWorkletProcessor {
   constructor(){super();this.above=Array(9).fill(false);}
   process(inputs){const found=[];for(let t=0;t<inputs.length;t++){const ch=inputs[t][0];if(!ch)continue;for(let s=0;s<ch.length;s++){const high=Math.abs(ch[s])>0.001;if(high&&!this.above[t])found.push({track:t,time:(currentFrame+s)/sampleRate});this.above[t]=high;}}if(found.length)this.port.postMessage(found);return true;}
  } registerProcessor('onset-audit',OnsetAudit);`;
  const url=URL.createObjectURL(new Blob([processor],{type:'text/javascript'}));
  await ctx.audioWorklet.addModule(url); URL.revokeObjectURL(url);
  const tap=new AudioWorkletNode(ctx,'onset-audit',{numberOfInputs:9,numberOfOutputs:1,outputChannelCount:[1]});
  audio.getTrackGains().forEach((g,t)=>g.connect(tap,0,t)); tap.connect(ctx.destination);
  tap.port.onmessage=e=>a.onsets.push(...e.data); a.tap=tap;
  const bus=window.__SEQ_EVENT_BUS__;
  bus.on('engine:trigger',e=>a.triggers.push({...e,at:ctx.currentTime,epoch:a.epoch}));
  bus.on('engine:step',e=>{const ts=ctx.getOutputTimestamp();a.visuals.push({...e,at:ctx.currentTime,epoch:a.epoch,outputAt:ts.contextTime+(performance.now()-ts.performanceTime)/1000,outputTimestamp:ts});});
  bus.on('engine:stop',()=>a.stops.push({at:ctx.currentTime,epoch:a.epoch}));
  let prev='';
  const frame=()=>{
   const marker=[...document.querySelectorAll('.phrase-slot')].findIndex(e=>e.classList.contains('playing-phrase'));
   const value=marker+':'+a.epoch;
   if(value!==prev){a.markers.push({marker,at:ctx.currentTime,epoch:a.epoch});prev=value;}
   a.raf=requestAnimationFrame(frame);
  }; frame();
 },cfg);
 console.log('INSTRUMENTED '+cfg.name);
 if(cfg.cpu){const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:cfg.cpu});}
 await page.click('#play-btn');
 await page.evaluate(cfg=>{
  const a=window.__audit;
  if(cfg.stall)a.loadTimer=setInterval(()=>{const until=performance.now()+cfg.stall;while(performance.now()<until){Math.sqrt(performance.now());}},cfg.stall===180?500:180);
  if(cfg.edit)a.editTimer=setInterval(()=>{
   const idx=(a.actions.length*7)%12;
   document.querySelectorAll('.phrase-slot')[idx].click();
   a.actions.push({type:'view',phrase:idx,at:a.ctx.currentTime});
  },230);
  if(cfg.cycles)a.tempoTimer=setInterval(()=>{
   const tempi=[40,220,41,219,120,160,80];const bpm=tempi[a.actions.length%tempi.length];
   const input=document.querySelector('#bpm-range');input.value=String(bpm);input.dispatchEvent(new Event('input',{bubbles:true}));
   a.actions.push({type:'bpm',bpm,at:a.ctx.currentTime});
  },360);
 },cfg);
 console.log('PLAYING '+cfg.name);
 await page.waitForTimeout(cfg.duration);
 await page.evaluate(()=>{const a=window.__audit;clearInterval(a.loadTimer);clearInterval(a.editTimer);clearInterval(a.tempoTimer);});
 if(cfg.cycles){
  await page.evaluate(async()=>{
   const a=window.__audit;
   for(let i=0;i<40;i++){
    document.querySelector('#stop-btn').click();await new Promise(r=>setTimeout(r,i%4*7));
    a.epoch++;document.querySelector('#play-btn').click();
    await new Promise(r=>setTimeout(r,20+(i%7)*19));
   }
  });
 }
 await page.click('#stop-btn');
 await page.waitForTimeout(500);
 const raw=await page.evaluate(()=>{
  const a=window.__audit;cancelAnimationFrame(a.raf);
  return {starts:a.starts,triggers:a.triggers,visuals:a.visuals,markers:a.markers,onsets:a.onsets,stops:a.stops,actions:a.actions,alive:a.alive.size,lit:document.querySelectorAll('.playing').length,marked:document.querySelectorAll('.playing-phrase').length,contexts:window.__ctxs.map(c=>({state:c.state,sampleRate:c.sampleRate,baseLatency:c.baseLatency,outputLatency:c.outputLatency})),sampleRate:a.ctx.sampleRate};
 });
 function stats(values){const a=[...values].sort((a,b)=>a-b);return {n:a.length,min:a[0]??null,median:a[Math.floor(a.length*.5)]??null,p95:a[Math.floor(a.length*.95)]??null,p99:a[Math.floor(a.length*.99)]??null,max:a.at(-1)??null};}
 const steps=raw.triggers.filter(e=>e.track===0);
 const queues=new Map();for(const s of steps){const key=[s.epoch,s.phrase,s.step].join(':');if(!queues.has(key))queues.set(key,[]);queues.get(key).push(s);}
 const visualErrors=[],outputLeads=[];let unmatchedVisuals=0;
 for(const v of raw.visuals){const s=queues.get([v.epoch,v.phrase,v.step].join(':'))?.shift();if(s){visualErrors.push((v.at-s.time)*1000);outputLeads.push((s.time-v.outputAt)*1000);}else unmatchedVisuals++;}
 const boundaries=[];
 for(let i=1;i<steps.length;i++){
  const s=steps[i],p=steps[i-1];if(s.epoch!==p.epoch||s.phrase===p.phrase)continue;
  const marker=raw.markers.filter(m=>m.epoch===s.epoch&&m.marker===s.phrase&&m.at>=p.time-.5&&m.at<=s.time+.5).at(-1);
  boundaries.push({phrase:s.phrase,time:s.time,markerAt:marker?.at??null,leadMs:marker?(s.time-marker.at)*1000:null});
 }
 let missingTracks=0,skew=0,sequenceErrors=0;
 for(let i=0;i<steps.length;i++){
  const s=steps[i];const group=raw.triggers.filter(e=>e.epoch===s.epoch&&e.phrase===s.phrase&&e.step===s.step&&Math.abs(e.time-s.time)<.00001);
  if(new Set(group.map(e=>e.track)).size!==9)missingTracks++;
  skew=Math.max(skew,...group.map(e=>Math.abs(e.time-s.time)*1000));
  if(i&&steps[i-1].epoch===s.epoch&&s.step!==(steps[i-1].step+1)%64)sequenceErrors++;
 }
 const onset0=raw.onsets.filter(e=>e.track===0);
 const onsetErrors=onset0.map(e=>(e.time-steps.reduce((best,s)=>Math.abs(s.time-e.time)<Math.abs(best.time-e.time)?s:best,steps[0]).time)*1000);
 const onsetSkew=[];for(const e of onset0){const partners=Array.from({length:8},(_,i)=>raw.onsets.filter(o=>o.track===i+1&&Math.abs(o.time-e.time)<.03).sort((x,y)=>Math.abs(x.time-e.time)-Math.abs(y.time-e.time))[0]);if(partners.every(Boolean))onsetSkew.push(Math.max(...partners.map(o=>Math.abs(o.time-e.time)*1000)));}
 const summary={...cfg,errors,steps:steps.length,sources:raw.starts.length,lateSources:raw.starts.filter(s=>s.time<s.at-.001).length,scheduleLeadMs:stats(raw.starts.map(s=>(s.time-s.at)*1000)),visualErrorMs:stats(visualErrors),estimatedOutputLeadMs:stats(outputLeads),unmatchedVisuals,sequenceErrors,missingTracks,scheduleSkewMs:skew,onsetErrorMs:stats(onsetErrors),onsetTrackSkewMs:stats(onsetSkew),boundaries,aliveAfterStop:raw.alive,litAfterStop:raw.lit,markedAfterStop:raw.marked,contexts:raw.contexts};
 results.push(summary);
 await fs.writeFile(`${out}/${cfg.name}.raw.json`,JSON.stringify(raw));
 await fs.writeFile(`${out}/stress-results.json`,JSON.stringify(results,null,2));
 console.log(JSON.stringify(summary));
 await context.close();
}
}finally{await browser.close();}
