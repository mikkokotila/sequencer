import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const b=await chromium.launch({headless:false});const results=[];
for(const loops of [0,2000000]){
  const p=await b.newPage();
  await p.addInitScript(()=>{
    window.qcMessages=[];const Original=AudioWorkletNode;
    window.AudioWorkletNode=new Proxy(Original,{construct(target,args){const n=Reflect.construct(target,args);n.port.addEventListener('message',e=>{if(e.data?.qc)qcMessages.push(e.data);});return n;}});
  });
  await p.route('**/tests/benchmark.html',async route=>{
    const response=await route.fetch();let text=await response.text();
    text=text.replace('const t0 = hasPerf ? performance.now() : 0;',`const t0 = hasPerf ? performance.now() : 0;
      if(!this._qcSent){this.port.postMessage({qc:true,hasPerf,quantum:outputs[0][0].length,sampleRate});this._qcSent=true;}
      let qcTotal=0;for(let i=0;i<${loops};i++)qcTotal+=Math.sin(i);this._qcSink=qcTotal;`);
    await route.fulfill({response,body:text});
  });
  await p.goto('http://127.0.0.1:5173/tests/benchmark.html');await p.selectOption('#duration','5');
  const started=Date.now();await p.click('#run-btn');await p.waitForSelector('#gate.pass,#gate.fail',{timeout:45000});
  const r=await p.evaluate(()=>({gate:document.querySelector('#gate').textContent,p99:document.querySelector('#p99').textContent,budget:document.querySelector('#budget').textContent,messages:qcMessages}));
  r.injectedSinIterationsPerQuantum=loops;r.wallMs=Date.now()-started;results.push(r);console.log(JSON.stringify(r));await p.close();
}
await writeFile(new URL('benchmark-audit-results.json',import.meta.url),JSON.stringify(results,null,2));await b.close();
