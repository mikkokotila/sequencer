import { firefox } from 'playwright';
import { writeFile } from 'node:fs/promises';
const output=[];
for(const headless of [true,false]){
 const r={headless,errors:[],logs:[],stages:[]};let b;
 try{
  b=await firefox.launch({headless,timeout:15000});const p=await b.newPage();p.setDefaultTimeout(8000);
  p.on('pageerror',e=>r.errors.push(e.message));p.on('console',m=>{if(m.type()==='error'||m.type()==='warning')r.logs.push(m.text());});
  await p.goto('http://127.0.0.1:5173');await p.waitForSelector('html[data-ready="true"]');
  await p.evaluate(async()=>{window.a=await import('/src/engine/audio.ts');window.s=await import('/src/engine/scheduler.ts');});
  r.stages.push(await p.evaluate(()=>({stage:'ready',state:a.getAudioContext().state,time:a.getAudioContext().currentTime,playing:s.isPlaying()})));
  await p.click('#play-btn');await p.waitForTimeout(1500);
  r.stages.push(await p.evaluate(()=>({stage:'play-click',state:a.getAudioContext().state,time:a.getAudioContext().currentTime,playing:s.isPlaying()})));
  // Independent native AudioContext: distinguish package behavior from host/browser audio backend.
  await p.evaluate(()=>{window.native=new AudioContext();window.resumeResult='pending';native.resume().then(()=>resumeResult='resolved',e=>resumeResult=e.message);});
  await p.waitForTimeout(1500);
  r.stages.push(await p.evaluate(()=>({stage:'independent-native',state:native.state,time:native.currentTime,resumeResult})));
 }catch(e){r.error=e.message;}
 output.push(r);console.log(JSON.stringify(r));await writeFile(new URL('firefox-diagnosis-results.json',import.meta.url),JSON.stringify(output,null,2));
 if(b)await Promise.race([b.close(),new Promise(r=>setTimeout(r,2500))]);
}
process.exit(0);
