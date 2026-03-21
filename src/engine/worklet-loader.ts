/**
 * AudioWorklet loader — registers worklet processors with the AudioContext.
 * Uses Vite's ?url imports to resolve worklet module paths.
 */

// Vite resolves these to URLs at build time
import compressorUrl from './worklets/compressor-processor.ts?url';
import saturationUrl from './worklets/saturation-processor.ts?url';
import freeverbUrl from './worklets/freeverb-processor.ts?url';
import delayUrl from './worklets/delay-processor.ts?url';

const loaded = new Set<string>();

async function load(ctx: AudioContext, name: string, url: string): Promise<void> {
  if (loaded.has(name)) return;
  await ctx.audioWorklet.addModule(url);
  loaded.add(name);
}

/**
 * Load all DSP worklet processors. Call once during audio init.
 */
export async function loadAllWorklets(ctx: AudioContext): Promise<void> {
  await Promise.all([
    load(ctx, 'compressor-processor', compressorUrl),
    load(ctx, 'saturation-processor', saturationUrl),
    load(ctx, 'freeverb-processor', freeverbUrl),
    load(ctx, 'delay-processor', delayUrl),
  ]);
}
