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
    load(ctx, 'transformer-processor', transformerUrl),
  ]);
}
