/**
 * AudioWorklet loader — registers worklet processors with the AudioContext.
 * Uses Vite's worker build pipeline to compile TypeScript into JavaScript modules.
 */

// Vite resolves these to URLs at build time
import compressorUrl from './worklets/compressor-processor.ts?worker&url';
import saturationUrl from './worklets/saturation-processor.ts?worker&url';
import freeverbUrl from './worklets/freeverb-processor.ts?worker&url';
import delayUrl from './worklets/delay-processor.ts?worker&url';
import transformerUrl from './worklets/transformer-processor.ts?worker&url';

// Registration belongs to each context, including each independent offline bounce.
const loaded = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>();

function load(ctx: BaseAudioContext, name: string, url: string): Promise<void> {
  let modules = loaded.get(ctx);
  if (!modules) {
    modules = new Map();
    loaded.set(ctx, modules);
  }
  let pending = modules.get(name);
  if (!pending) {
    pending = ctx.audioWorklet.addModule(url).catch((error: unknown) => {
      modules.delete(name);
      throw error;
    });
    modules.set(name, pending);
  }
  return pending;
}

/** Register the same DSP processors for live playback and offline rendering. */
export async function loadAllWorklets(ctx: BaseAudioContext): Promise<void> {
  await Promise.all([
    load(ctx, 'compressor-processor', compressorUrl),
    load(ctx, 'saturation-processor', saturationUrl),
    load(ctx, 'freeverb-processor', freeverbUrl),
    load(ctx, 'delay-processor', delayUrl),
    load(ctx, 'transformer-processor', transformerUrl),
  ]);
}
