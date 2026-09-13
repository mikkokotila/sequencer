/** Read-only product QC: isolated browser databases, synthetic samples, deterministic seed. */
import { chromium } from 'playwright';
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const output = process.env.QC_OUTPUT || path.dirname(new URL(import.meta.url).pathname);
const base = process.env.QC_URL || 'http://127.0.0.1:5173';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: false, args: ['--autoplay-policy=no-user-gesture-required'] });
const results = [];
const assert = (ok, message) => { if (!ok) throw new Error(message); };
async function modules(page) {
  await page.evaluate(async () => {
    const names = { audio:'engine/audio', song:'transport/song', patterns:'transport/patterns', persistence:'transport/persistence', adsr:'engine/adsr', midi:'engine/midi', scheduler:'engine/scheduler', extensions:'engine/extensions/store', ui:'ui/build', events:'events', render:'transport/render', wav:'transport/wav' };
    window.q = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([k,v]) => [k, await import(`/src/${v}.ts`)])));
    window.fixture = () => {
      const ctx = q.audio.getAudioContext();
      const b = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = b.getChannelData(0);
      for(let i=0;i<d.length;i++) d[i] = Math.sin(2*Math.PI*440*i/ctx.sampleRate)*0.1;
      const data = q.wav.audioBufferToWav24(b).buffer;
      return { name:'synthetic-440.wav', data };
    };
    window.sleep = ms => new Promise(r=>setTimeout(r,ms));
  });
}
async function fresh(context, setup) {
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.probe = { sources:[], starts:[], errors:[], gains:[], filters:[], compressors:[], contexts:0 };
    const C = window.AudioContext;
    window.AudioContext = class extends C { constructor(...a){ super(...a); probe.contexts++; } };
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function(...a) {
      const entry = { node:this, ended:false, time:a[0]??0, at:this.context.currentTime };
      probe.sources.push(entry); probe.starts.push({time:entry.time,at:entry.at});
      this.addEventListener('ended',()=>entry.ended=true,{once:true});
      return start.apply(this,a);
    };
    for(const [method,key] of [['createGain','gains'],['createBiquadFilter','filters'],['createDynamicsCompressor','compressors']]) {
      const orig = BaseAudioContext.prototype[method];
      BaseAudioContext.prototype[method] = function(...a){ const v=orig.apply(this,a); probe[key].push(v);return v; };
    }
    const input = new EventTarget();
    Object.assign(input,{id:'synthetic-midi',name:'Synthetic QC',manufacturer:'QC',state:'connected'});
    window.midiInput=input;
    const access={inputs:new Map([[input.id,input]]),onstatechange:null};
    window.midiAccess=access;
    Object.defineProperty(navigator,'requestMIDIAccess',{configurable:true,value:async()=>access});
    window.sendMidi=(status,note,vel)=>{const e=new Event('midimessage');e.data=new Uint8Array([status,note,vel]);input.dispatchEvent(e);};
  });
  if(setup) await setup(page);
  await page.goto(base);
  await page.waitForSelector('html[data-ready="true"]',{timeout:12000});
  await modules(page);
  return page;
}
async function run(id, fn) {
  if(process.env.QC_CASE && !id.includes(process.env.QC_CASE)) return;
  const context = await browser.newContext({viewport:{width:1440,height:1000}});
  const row = {id,status:'PASS',measurements:{},consoleErrors:[],pageErrors:[]};
  context.on('page',p=>{
    p.on('pageerror',e=>row.pageErrors.push(e.message));
    p.on('console',m=>{if(m.type()==='error')row.consoleErrors.push(m.text().slice(0,600));});
  });
  const start=Date.now();
  try {await fn(context,row);} catch(e) {row.status='FAIL';row.failure=e.message;}
  row.durationMs=Date.now()-start;
  results.push(row); await context.close();
  await writeFile(path.join(output, 'pressure-results.json'),JSON.stringify({testedCommit:'cd2564ccb172832a47b0c180ced32fbf3927256d',seed:20260913,results},null,2));
  console.log(`${row.status} ${id} ${JSON.stringify(row.measurements)} ${row.failure||''}`);
}
await run('seeded-5000-edit-copy-fill-persistence',async(c,r)=>{
  const p=await fresh(c);
  r.measurements=await p.evaluate(async()=>{
    await q.persistence.newSong();
    let seed=20260913; const rnd=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return (seed>>>8)%n;};
    const expected=structuredClone(q.patterns.phrases);const operationCounts=Array(6).fill(0);
    for(let i=0;i<5000;i++){
      const pi=rnd(12),t=rnd(5),s=rnd(64),n=rnd(12),op=rnd(6),v=!!rnd(2);
      operationCounts[op]++;q.patterns.switchToPhrase(pi);
      if(op===0){q.patterns.setDrumStep(t,s,v);expected[pi].drumPat[t][s]=v;}
      if(op===1){q.patterns.setMelodyCell(t%3,s,11-n,v);if(t%3===0&&v)expected[pi].melPat[0][s].fill(false);expected[pi].melPat[t%3][s][n]=v;}
      if(op===2){q.patterns.setVocalStep(s,v);expected[pi].vocalPat[s]=v;}
      if(op===3&&pi>0){q.patterns.fillWithPrev(pi);expected[pi]=structuredClone(expected[pi-1]);}
      if(op===4){q.patterns.clearDrumTrack(t);expected[pi].drumPat[t].fill(false);}
      if(op===5){q.patterns.replicateTrack('drum',t);for(let s=16;s<64;s++)expected[pi].drumPat[t][s]=expected[pi].drumPat[t][s%16];}
    }
    const stateMatches=JSON.stringify(expected)===JSON.stringify(q.patterns.phrases);
    q.song.setBpm(177);q.song.setCurrentSongName('Seeded QC');await q.persistence.saveSong();
    const saved=await q.persistence.dbGet('songs',q.song.currentSongId);
    window.expected=JSON.stringify(expected);
    return {operations:5000,operationCounts,stateMatches,savedMatches:JSON.stringify(saved.phrases)===window.expected};
  });
  const expected=await p.evaluate(()=>window.expected);
  await p.reload();await p.waitForSelector('html[data-ready="true"]');await modules(p);
  r.measurements.reloadMatches=await p.evaluate(e=>JSON.stringify(q.patterns.phrases)===e,expected);
  assert(r.measurements.operationCounts.every(n=>n>0)&&r.measurements.stateMatches&&r.measurements.savedMatches&&r.measurements.reloadMatches,'Edit/model/database/reload mismatch');
});
await run('loaded-audio-survives-indexeddb-reload',async(c,r)=>{
  const p=await fresh(c);
  r.measurements.before=await p.evaluate(async()=>{
    const d=q.persistence.collectSongData('Sample');d.drumSampleData[0]=fixture();await q.persistence.loadSong(d);await q.persistence.saveSong();
    return {bytes:q.song.drumSampleData[0].data.byteLength,length:q.song.drumBuf[0].length};
  });
  await p.reload();await p.waitForSelector('html[data-ready="true"]');await modules(p);
  r.measurements.after=await p.evaluate(()=>({bytes:q.song.drumSampleData[0].data.byteLength,length:q.song.drumBuf[0].length}));
  assert(JSON.stringify(r.measurements.before)===JSON.stringify(r.measurements.after),'Sample changed after reload');
});
await run('adsr-and-master-save-reload',async(c,r)=>{
  const p=await fresh(c);
  r.measurements.before=await p.evaluate(async()=>{
    q.adsr.setAdsrEnabled(0,true);q.adsr.setTrackAdsr(0,{attack:.42,decay:.7,sustain:.25,release:1.3});
    const mixer=q.extensions.SEQ_EXTENSIONS.find(e=>e.id==='mixer');mixer._enabled=true;mixer.setEnabled(true);
    q.audio.getMasterGain().gain.value=.23;await q.persistence.saveSong();
    return {adsr:{...q.adsr.getTrackAdsr(0)},enabled:q.adsr.isAdsrEnabled(0),master:q.audio.getMasterGain().gain.value};
  });
  await p.reload();await p.waitForSelector('html[data-ready="true"]');await modules(p);
  r.measurements.after=await p.evaluate(()=>({adsr:q.adsr.getTrackAdsr(0),enabled:q.adsr.isAdsrEnabled(0),master:q.audio.getMasterGain().gain.value}));
  assert(JSON.stringify(r.measurements.before)===JSON.stringify(r.measurements.after),'ADSR/master settings silently lost after save/reload');
});
await run('pattern-file-export-import-with-sample',async(c,r)=>{
  const p=await fresh(c);
  await p.evaluate(async()=>{const d=q.persistence.collectSongData('Export QC');d.drumSampleData[0]=fixture();await q.persistence.loadSong(d);q.ui.refreshUI();});
  const download=p.waitForEvent('download');await p.locator('#save-btn').click();const d=await download;
  const bytes=await readFile(await d.path());const parsed=JSON.parse(bytes);
  r.measurements={exportBytes:bytes.length,sampleData:parsed.drumSampleData[0].data};
  const chooser=p.waitForEvent('filechooser');await p.locator('#load-btn').click();await (await chooser).setFiles({name:'export.json',mimeType:'application/json',buffer:bytes});
  await p.waitForTimeout(400);
  r.measurements.after=await p.evaluate(()=>({sampleLoaded:!!q.song.drumBuf[0],sampleDataType:Object.prototype.toString.call(q.song.drumSampleData[0]?.data)}));
  assert(r.measurements.after.sampleLoaded,'An exported pattern with a loaded sample cannot reload its audio');
});
await run('valid-pattern-file-roundtrip',async(c,r)=>{
  const p=await fresh(c);const original=await p.evaluate(()=>JSON.stringify(q.patterns.phrases));
  const download=p.waitForEvent('download');await p.locator('#save-btn').click();const bytes=await readFile(await (await download).path());
  await p.evaluate(()=>q.persistence.newSong());
  const chooser=p.waitForEvent('filechooser');await p.locator('#load-btn').click();await(await chooser).setFiles({name:'valid.json',mimeType:'application/json',buffer:bytes});
  await p.waitForFunction(o=>JSON.stringify(q.patterns.phrases)===o,original);
  r.measurements={bytes:bytes.length,patternsRestored:true};
});
await run('six-extension-settings-save-reload',async(c,r)=>{
  const p=await fresh(c);
  const before=await p.evaluate(async()=>{
    for(const ext of q.extensions.SEQ_EXTENSIONS){ext._enabled=true;ext.setEnabled?.(true);}
    await q.persistence.saveSong();return q.persistence.collectSongData('Extensions').extensions;
  });
  await p.reload();await p.waitForSelector('html[data-ready="true"]');await modules(p);
  const after=await p.evaluate(()=>q.persistence.collectSongData('Extensions').extensions);
  r.measurements={count:Object.keys(before).length,unchanged:JSON.stringify(before)===JSON.stringify(after)};
  assert(r.measurements.count===6&&r.measurements.unchanged,'Extension settings changed after reload');
});
for(const [label,content] of [['syntax','{'],['negative-bpm',JSON.stringify({name:'Invalid',bpm:-10})],['invalid-phrase',JSON.stringify({name:'Invalid',currentPhrase:99})],['object-name',JSON.stringify({name:{x:1}})]]){
  await run(`import-rejects-${label}-without-state-loss`,async(c,r)=>{
    const p=await fresh(c);const before=await p.evaluate(()=>JSON.stringify(q.persistence.collectSongData('Before').phrases));
    const chooser=p.waitForEvent('filechooser');await p.locator('#load-btn').click();await (await chooser).setFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(content)});
    await p.waitForTimeout(250);
    r.measurements=await p.evaluate(before=>({patternsPreserved:JSON.stringify(q.patterns.phrases)===before,bpm:q.song.bpm,phrase:q.patterns.currentPhrase,name:q.song.currentSongName,errorVisible:!!document.querySelector('#load-btn.error,#load-btn.load-error,[role="alert"]'),title:document.querySelector('#load-btn').title}),before);
    assert(r.measurements.patternsPreserved&&r.measurements.errorVisible,'Invalid import must preserve the song and report a visible error');
  });
}
await run('delete-only-song-does-not-resurrect-it',async(c,r)=>{
  const p=await fresh(c);const old=await p.evaluate(()=>q.song.currentSongId);
  await p.locator('#song-del').click();await p.waitForFunction(id=>q.song.currentSongId!==id,old);
  r.measurements=await p.evaluate(async old=>({deletedId:old,currentId:q.song.currentSongId,storedIds:(await q.persistence.dbGetAll('songs')).map(x=>x.id)}),old);
  assert(!r.measurements.storedIds.includes(old),'Deleting the last song saves it back before creating its replacement');
});
await run('latest-song-load-wins-under-slow-decode',async(c,r)=>{
  const p=await fresh(c);
  r.measurements=await p.evaluate(async()=>{
    const a=q.persistence.collectSongData('Slow older song');a.id='slow-A';a.drumSampleData[0]=fixture();
    const b=q.persistence.collectSongData('Latest song');b.id='latest-B';b.bpm=189;b.drumSampleData.fill(null);
    const ctx=q.audio.getAudioContext(),decode=ctx.decodeAudioData.bind(ctx);let release;
    const gate=new Promise(r=>release=r);let first=true;
    ctx.decodeAudioData=async(...args)=>{if(first){first=false;await gate;}return decode(...args);};
    const loading=q.persistence.loadSong(a);await sleep(20);await q.persistence.loadSong(b);release();await loading;
    return {id:q.song.currentSongId,name:q.song.currentSongName,bpm:q.song.bpm,sampleLoaded:!!q.song.drumBuf[0]};
  });
  assert(r.measurements.id==='latest-B'&&!r.measurements.sampleLoaded,'Older async load overwrote the newer song with mixed state');
});
await run('aborted-storage-transaction-must-reject',async(c,r)=>{
  const p=await fresh(c);
  r.measurements=await p.evaluate(async()=>{
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){const req=original.apply(this,args);const tx=this.transaction;req.addEventListener('success',()=>tx.abort(),{once:true});return req;};
    let resolved=false,error=null;try{await q.persistence.dbPut('songs',{id:'aborted',name:'Not committed'});resolved=true;}catch(e){error=e.message;}
    IDBObjectStore.prototype.put=original;await sleep(30);
    return {resolved,error,stored:!!await q.persistence.dbGet('songs','aborted')};
  });
  assert(!r.measurements.resolved&&!r.measurements.stored,'Storage API reports success even though transaction aborts and data was not saved');
});
await run('two-tabs-detect-or-preserve-conflicting-edits',async(c,r)=>{
  const p=await fresh(c);const p2=await fresh(c);
  await p.evaluate(async()=>{q.song.setCurrentSongName('New name in tab A');await q.persistence.saveSong();});
  await p2.evaluate(async()=>{q.song.setBpm(175);await q.persistence.saveSong();});
  r.measurements=await p.evaluate(async()=>{const d=await q.persistence.dbGet('songs',q.song.currentSongId);return {name:d.name,bpm:d.bpm};});
  assert(r.measurements.name==='New name in tab A'&&r.measurements.bpm===175,'Stale tab silently overwrites another tab’s saved changes');
});
await run('new-song-resets-engine-controls',async(c,r)=>{
  const p=await fresh(c);
  await p.evaluate(async()=>{const engine=await import('/src/ui/engine-panel.ts');engine.open();});
  const sliders=await p.locator('#engine-panel input[type=range]').count();
  r.measurements.sliderCount=sliders;
  await p.locator('#engine-panel input[type=range]').evaluateAll(nodes=>nodes.forEach(n=>{n.value=n.min;n.dispatchEvent(new Event('input',{bubbles:true}));}));
  await p.evaluate(()=>q.persistence.newSong());
  r.measurements.lowpassFrequencies=await p.evaluate(()=>probe.filters.filter(n=>n.type==='lowpass').map(n=>n.frequency.value));
  assert(r.measurements.lowpassFrequencies.every(v=>v>=19999),'New Song retains engine filtering from the previous song');
});
await run('midi-repeated-note-off-stops-all-voices',async(c,r)=>{
  const p=await fresh(c);
  await p.locator('#play-btn').click();await p.locator('#stop-btn').click();
  await p.waitForFunction(()=>q.audio.getAudioContext().currentTime>.35);
  r.measurements=await p.evaluate(async()=>{
    const ctx=q.audio.getAudioContext();await ctx.resume();const initialTime=ctx.currentTime;const buf=ctx.createBuffer(1,ctx.sampleRate*4,ctx.sampleRate);buf.getChannelData(0).fill(.01);q.song.melBuf[1]=buf;
    q.midi.connectMidiToTrack('synthetic-midi',1);
    sendMidi(0x90,24,100);await sleep(30);sendMidi(0x90,24,100);await sleep(30);sendMidi(0x80,24,0);await sleep(150);
    const afterOff=probe.sources.filter(s=>!s.ended).length;q.midi.disconnectAllMidi();await sleep(100);
    return {contextState:ctx.state,clockAdvance:ctx.currentTime-initialTime,started:probe.sources.length,afterNoteOff:afterOff,afterDisconnect:probe.sources.filter(s=>!s.ended).length};
  });
  assert(r.measurements.afterNoteOff===0&&r.measurements.afterDisconnect===0,'Repeated MIDI pitch leaves an untracked voice playing after note-off/disconnect');
});
await run('midi-mono-retrigger-ended-race',async(c,r)=>{
  const p=await fresh(c);
  await p.locator('#play-btn').click();await p.locator('#stop-btn').click();
  await p.waitForFunction(()=>q.audio.getAudioContext().currentTime>.35);
  r.measurements=await p.evaluate(async()=>{
    const ctx=q.audio.getAudioContext();await ctx.resume();const initialTime=ctx.currentTime;const buf=ctx.createBuffer(1,ctx.sampleRate*3,ctx.sampleRate);buf.getChannelData(0).fill(.01);q.song.melBuf[0]=buf;
    q.midi.connectMidiToTrack('synthetic-midi',0);sendMidi(0x90,24,100);await sleep(20);sendMidi(0x90,24,100);await sleep(120);sendMidi(0x80,24,0);await sleep(120);
    return {contextState:ctx.state,clockAdvance:ctx.currentTime-initialTime,started:probe.sources.length,active:probe.sources.filter(s=>!s.ended).length};
  });
  assert(r.measurements.active===0,'Old ended callback deletes the replacement MIDI voice, so note-off misses it');
});
await run('midi-polyphony-stealing-and-device-disconnect',async(c,r)=>{
  const p=await fresh(c);
  await p.locator('#play-btn').click();await p.locator('#stop-btn').click();
  await p.waitForFunction(()=>q.audio.getAudioContext().currentTime>.35);
  r.measurements=await p.evaluate(async()=>{
    const ctx=q.audio.getAudioContext();await ctx.resume();const initialTime=ctx.currentTime;const b=ctx.createBuffer(1,ctx.sampleRate*10,ctx.sampleRate);b.getChannelData(0).fill(.01);q.song.melBuf[1]=b;
    q.midi.connectMidiToTrack('synthetic-midi',1);for(let n=24;n<40;n++)sendMidi(0x90,n,100);await sleep(100);
    const playing=probe.sources.filter(s=>!s.ended).length;midiInput.state='disconnected';midiAccess.onstatechange();await sleep(100);
    return {contextState:ctx.state,clockAdvance:ctx.currentTime-initialTime,started:probe.sources.length,playing,afterDisconnect:probe.sources.filter(s=>!s.ended).length,binding:q.midi.getMidiTrackBinding(1)};
  });
  assert(r.measurements.playing<=8&&r.measurements.afterDisconnect===0&&!r.measurements.binding,'MIDI polyphony/device cleanup failed');
});
await run('offline-render-duration-onsets-pan-mute-and-pcm',async(c,r)=>{
  const p=await fresh(c);
  r.measurements=await p.evaluate(async()=>{
    await q.persistence.newSong();q.song.setBpm(220);const ctx=q.audio.getAudioContext(),pulse=ctx.createBuffer(1,480,48000);pulse.getChannelData(0).fill(.1);q.song.drumBuf[0]=pulse;
    const steps=[0,7,16,31,47,63];steps.forEach(s=>q.patterns.setDrumStep(0,s,true));q.audio.getChannelFaders()[0].gain.value=.5;q.audio.getMasterGain().gain.value=.8;q.audio.getChannelPans()[0].pan.value=-1;
    const b=await q.render.renderPhraseToBuffer(0),l=b.getChannelData(0),right=b.getChannelData(1),onsets=[];
    let peak=0,rightPeak=0,finite=true;for(let i=0;i<l.length;i++){peak=Math.max(peak,Math.abs(l[i]));rightPeak=Math.max(rightPeak,Math.abs(right[i]));finite&&=Number.isFinite(l[i])&&Number.isFinite(right[i]);if(l[i]>.01&&(i===0||l[i-1]<=.01))onsets.push(i);}
    q.song.setMuted(0,true);const muted=await q.render.renderPhraseToBuffer(0);let mutedPeak=0;for(const v of muted.getChannelData(0))mutedPeak=Math.max(mutedPeak,Math.abs(v));
    const expected=steps.map(s=>Math.round(s*60/220/4*b.sampleRate));
    const extreme=ctx.createBuffer(2,5,48000);extreme.getChannelData(0).set([-2,-1,0,1,2]);extreme.getChannelData(1).set([.5,-.5,.25,-.25,0]);const wav=q.wav.audioBufferToWav24(extreme);
    const ints=[];for(let i=44;i<wav.length;i+=3){let v=wav[i]|wav[i+1]<<8|wav[i+2]<<16;if(v&0x800000)v-=0x1000000;ints.push(v);}
    return {frames:b.length,expectedFrames:Math.ceil((64*60/220/4+1)*b.sampleRate),onsets,expected,peak,rightPeak,mutedPeak,finite,pcm:ints};
  });
  const x=r.measurements;assert(x.frames===x.expectedFrames&&x.finite&&x.onsets.length===6&&x.onsets.every((v,i)=>Math.abs(v-x.expected[i])<=1)&&Math.abs(x.peak-.04)<1e-6&&x.rightPeak===0&&x.mutedPeak===0&&x.pcm[0]===-8388608&&x.pcm[6]===8388607,'Offline render or WAV PCM violates independent frame/amplitude oracle');
});
await run('keyboard-space-is-inert-inside-modals',async(c,r)=>{
  const p=await fresh(c);await p.locator('.sample-btn').first().click();await p.locator('#browser-close').focus();await p.keyboard.press('Space');
  r.measurements=await p.evaluate(()=>({playing:q.scheduler.isPlaying(),browserOpen:document.querySelector('#browser-overlay').className}));
  assert(!r.measurements.playing,'Space on a modal button unexpectedly starts global playback');
});
for(const mode of ['indexeddb-denied','worklet-network-failure']){
  await run(`startup-recovery-${mode}`,async(c,r)=>{
    let p;try{
      p=await fresh(c,async p=>{
        if(mode==='indexeddb-denied')await p.addInitScript(()=>{indexedDB.open=()=>{throw new DOMException('QC storage denied','SecurityError');};});
        else await p.addInitScript(()=>{AudioWorklet.prototype.addModule=async()=>{throw new DOMException('QC worklet download failed','AbortError');};});
      });
    }catch(e){p=c.pages()[0];r.measurements.readyWait=e.message.split('\n')[0];}
    r.measurements.state=await p.evaluate(()=>({ready:document.documentElement.dataset.ready,playDisabled:document.querySelector('#play-btn')?.disabled,visibleError:!!document.querySelector('[role="alert"],.init-error'),text:document.body.innerText.slice(0,150)}));
    assert(r.measurements.state.visibleError,'Initialization failure strands the package without visible recovery feedback');
  });
}
await browser.close();
console.log(JSON.stringify({passed:results.filter(r=>r.status==='PASS').length,failed:results.filter(r=>r.status==='FAIL').length}));
