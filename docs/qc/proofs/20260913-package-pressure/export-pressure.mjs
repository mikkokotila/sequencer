import { chromium } from 'playwright';
import { writeFile, readFile } from 'node:fs/promises';
const b=await chromium.launch({headless:true});const p=await b.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://127.0.0.1:5173');await p.waitForSelector('html[data-ready="true"]');
const fixture=await p.evaluate(async()=>{
 const [audio,song,pat]=await Promise.all(['engine/audio','transport/song','transport/patterns'].map(n=>import(`/src/${n}.ts`)));const ctx=audio.getAudioContext();
 song.setBpm(220);song.setCurrentSongName('QC Twelve Phrases');pat.octaves.fill(1);
 const pulse=ctx.createBuffer(1,Math.ceil(ctx.sampleRate*.008),ctx.sampleRate);pulse.getChannelData(0).fill(.1);song.drumBuf.fill(pulse);song.melBuf.fill(pulse);song.setVocalBuf(pulse);
 for(const phrase of pat.phrases){phrase.drumPat.forEach(r=>r.fill(true));phrase.melPat.forEach(t=>t.forEach(s=>{s.fill(false);s[0]=true;}));phrase.vocalPat.fill(true);}
 audio.getChannelFaders().forEach(g=>g.gain.value=.05);audio.getMasterGain().gain.value=.8;
 return {sampleRate:ctx.sampleRate,frames:Math.ceil((64*60/220/4+1)*ctx.sampleRate),phrases:12,voices:6912};
});
const start=Date.now();const download=p.waitForEvent('download',{timeout:60000});await p.locator('#export-loops-btn').click();const d=await download;const bytes=await readFile(await d.path());
const zipPath=process.env.QC_ZIP||'/private/tmp/sequencer-qc-twelve-phrases.zip';await writeFile(zipPath,bytes);
const r={...fixture,bytes:bytes.length,wallMs:Date.now()-start,errors,name:d.suggestedFilename()};console.log(JSON.stringify(r));await writeFile(new URL('export-results.json',import.meta.url),JSON.stringify(r,null,2));await b.close();
