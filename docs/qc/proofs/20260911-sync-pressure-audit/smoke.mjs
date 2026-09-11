import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const require=createRequire(path.join(process.env.SEQUENCER_ROOT || process.cwd(), 'package.json'));
const {chromium}=require('playwright');
const browser=await chromium.launch({headless:true});
const results=[];
const out=process.env.AUDIT_OUTPUT || path.dirname(fileURLToPath(import.meta.url));
try{
for(const port of [5173,5175]){
 const page=await browser.newPage();const errors=[],consoleErrors=[],failures=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',e=>{if(e.type()==='error')consoleErrors.push(e.text())});page.on('requestfailed',r=>failures.push({url:r.url(),failure:r.failure()}));
 await page.goto(`http://127.0.0.1:${port}/`);await page.waitForTimeout(1600);
 const initial=await page.evaluate(()=>({tracks:document.querySelectorAll('.melody-track').length,extensions:document.querySelectorAll('.ext-icon-btn').length,title:document.title}));
 await page.click('#app');await page.click('#play-btn');await page.waitForTimeout(1000);
 const playing=await page.evaluate(()=>({highlights:document.querySelectorAll('.playing').length,marker:document.querySelectorAll('.playing-phrase').length}));
 await page.click('#stop-btn');
 let sample=null;
 if(port===5173){
  await page.locator('.melody-track[data-type="drum"][data-track="0"] .sample-btn').click();
  await page.locator('.browser-item').first().waitFor();
  await page.locator('.browser-item').first().click();await page.click('#browser-load');await page.waitForTimeout(1200);
  sample=await page.evaluate(async()=>{const s=await import('/src/transport/song.ts');return {decoded:!!s.drumBuf[0],duration:s.drumBuf[0]?.duration,sampleRate:s.drumBuf[0]?.sampleRate,overlayOpen:document.querySelector('#browser-overlay').classList.contains('open'),loadText:document.querySelector('#browser-load').textContent};});
 }
 await page.screenshot({path:`${out}/smoke-${port}.png`,fullPage:false});
 results.push({port,initial,playing,sample,errors,consoleErrors,failures});await page.close();
}
}finally{await browser.close();}
console.log(JSON.stringify(results,null,2));
await fs.writeFile(`${out}/smoke-results.json`,JSON.stringify(results,null,2));
