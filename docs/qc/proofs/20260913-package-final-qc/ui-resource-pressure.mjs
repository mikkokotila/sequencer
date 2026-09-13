import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser=await chromium.launch({headless:false});const p=await browser.newPage(),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://127.0.0.1:5173');await p.waitForSelector('html[data-ready="true"]');
const cdp=await p.context().newCDPSession(p);await cdp.send('Performance.enable');
const snapshots=[];
async function capture(cycles){await cdp.send('HeapProfiler.collectGarbage');const dom=await cdp.send('Memory.getDOMCounters');const metrics=(await cdp.send('Performance.getMetrics')).metrics;const heap=metrics.find(m=>m.name==='JSHeapUsedSize')?.value;snapshots.push({cycles,...dom,heap});}
for(let batch=0;batch<3;batch++){
  await p.evaluate(async()=>{
    const [engine,browser,registry]=await Promise.all([import('/src/ui/engine-panel.ts'),import('/src/ui/browser.ts'),import('/src/engine/extensions/registry.ts')]);
    for(let i=0;i<100;i++){engine.open();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));engine.close();browser.openBrowser('drum',i%5);browser.closeBrowser();const id=['pultec-eq','compressor','transformer','mixer','reverb','delay'][i%6];registry.toggleExtension(id);await new Promise(r=>setTimeout(r,20));registry.toggleExtension(id);}
  });
  await capture((batch+1)*100);console.log(JSON.stringify(snapshots.at(-1)));
}
const r={cycles:300,operations:1800,snapshots,errors,status:'PASS'};
// Compare post-warmup equal batches; allow bounded last-render DOM and 2 MB jitter.
const a=snapshots[0],z=snapshots[2];if(errors.length||z.documents>a.documents||z.nodes>a.nodes+100||z.jsEventListeners>a.jsEventListeners+100||z.heap>a.heap+2000000)r.status='FAIL';
await writeFile(new URL('ui-resource-results.json',import.meta.url),JSON.stringify(r,null,2));console.log(JSON.stringify(r));await browser.close();
