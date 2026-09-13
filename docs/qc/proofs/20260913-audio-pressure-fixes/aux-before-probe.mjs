import { chromium } from '/Users/mikkokotila/dev/sequencer/node_modules/playwright/index.mjs';
const browser = await chromium.launch({headless:false,args:['--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage();
await page.goto('http://127.0.0.1:5173');
await page.waitForSelector('html[data-ready="true"]');
const result = await page.evaluate(async () => {
  const audio = await import('/src/engine/audio.ts');
  const ctx = audio.getAudioContext();
  const results = [];
  for(const id of ['reverb','delay']) {
    const factory = await import(`/src/engine/extensions/${id}.ts`);
    const extension = id === 'reverb' ? factory.createReverb() : factory.createDelay();
    const mixBus=ctx.createGain(), masterGain=ctx.createGain();
    const channelFaders=Array.from({length:9},()=>ctx.createGain()),channelPans=channelFaders.map(()=>ctx.createStereoPanner());
    const callbacks=[];
    const host={channelFaders,channelPans,mixBus,masterGain,trackCount:9,onStop:f=>callbacks.push(f),getTrackInfo:()=>({name:'QC',type:'melody',color:'#888',bright:'#ccc'}),notifyStateChange(){}};
    let wet;
    const connect=AudioNode.prototype.connect;
    AudioNode.prototype.connect=function(...args){if(args[0]===mixBus&&this instanceof GainNode)wet=this;return connect.apply(this,args);};
    extension.init(ctx,host);
    AudioNode.prototype.connect=connect;
    extension.setEnabled(false);extension.setState({mix:.7});
    const disabledAfterSetState=wet.gain.value;
    extension.setEnabled(true);callbacks[0]();extension.setEnabled(false);
    await new Promise(r=>setTimeout(r,700));
    results.push({id,disabledAfterSetState,disabledAfterStopCallback:wet.gain.value});
    extension.destroy();
  }
  return results;
});
console.log(JSON.stringify(result,null,2));
await browser.close();
