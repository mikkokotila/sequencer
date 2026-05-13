/**
 * Offline phrase renderer — bounces a phrase's pattern to an AudioBuffer using
 * an OfflineAudioContext.
 *
 * Scope (minimal V1): channel strip (per-track fader + pan + mute), ADSR per
 * track, master gain, octaves/harmonies. Extension chain (Pultec EQ, Vari-Mu,
 * Transformer, Reverb, Delay) and engine-panel master nodes are NOT applied —
 * the exported loops are the dry sum of triggered samples through the channel
 * strip only.
 */

import { STEPS, DRUMS_CFG, MEL_CFG, HARMONY_SEMITONES, TOTAL_TRACKS } from '../config';
import { getAudioContext, getChannelFaders, getChannelPans, getMasterGain } from '../engine/audio';
import { applyEnvelope, isAdsrEnabled } from '../engine/adsr';
import { phrases, isPhraseEmpty, octaves, harmonies } from './patterns';
import { bpm, drumBuf, melBuf, vocalBuf, mutedArr } from './song';
import type { Phrase } from '../types';

const TAIL_SECONDS = 1.0;

interface ChannelStrip {
  trackGain: GainNode;
}

interface RenderGraph {
  ctx: OfflineAudioContext;
  strips: ChannelStrip[];
}

function buildGraph(sampleRate: number, lengthSamples: number): RenderGraph {
  const ctx = new OfflineAudioContext({
    numberOfChannels: 2,
    length: lengthSamples,
    sampleRate,
  });

  const liveFaders = getChannelFaders();
  const livePans = getChannelPans();
  const liveMaster = getMasterGain();

  const mixBus = ctx.createGain();
  mixBus.gain.value = 1.0;
  const masterTrim = ctx.createGain();
  masterTrim.gain.value = 1.0;
  const masterGain = ctx.createGain();
  masterGain.gain.value = liveMaster?.gain.value ?? 0.8;

  mixBus.connect(masterTrim);
  masterTrim.connect(masterGain);
  masterGain.connect(ctx.destination);

  const strips: ChannelStrip[] = [];
  for (let i = 0; i < TOTAL_TRACKS; i++) {
    const trackGain = ctx.createGain();
    trackGain.gain.value = 1.0;
    const fader = ctx.createGain();
    fader.gain.value = liveFaders[i]?.gain.value ?? 0.8;
    const pan = ctx.createStereoPanner();
    pan.pan.value = livePans[i]?.pan.value ?? 0;
    trackGain.connect(fader);
    fader.connect(pan);
    pan.connect(mixBus);
    strips.push({ trackGain });
  }

  return { ctx, strips };
}

function scheduleSample(
  ctx: OfflineAudioContext,
  buffer: AudioBuffer,
  time: number,
  rate: number | undefined,
  dest: AudioNode,
  trackIndex: number,
  stepDuration: number,
): void {
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  if (rate !== undefined) src.playbackRate.value = rate;

  if (isAdsrEnabled(trackIndex)) {
    const { stopAt } = applyEnvelope(ctx, src, dest, trackIndex, time, stepDuration);
    src.start(time);
    if (stopAt > 0) src.stop(stopAt);
  } else {
    src.connect(dest);
    src.start(time);
  }
}

function scheduleStep(
  ctx: OfflineAudioContext,
  strips: ChannelStrip[],
  phrase: Phrase,
  step: number,
  time: number,
  stepDur: number,
): void {
  // Drums
  for (let t = 0; t < DRUMS_CFG.length; t++) {
    const row = phrase.drumPat[t];
    const buf = drumBuf[t];
    const strip = strips[t];
    if (row?.[step] && !mutedArr[t] && buf && strip) {
      scheduleSample(ctx, buf, time, undefined, strip.trackGain, t, stepDur);
    }
  }

  // Melody
  for (let t = 0; t < MEL_CFG.length; t++) {
    const buf = melBuf[t];
    const trackIdx = DRUMS_CFG.length + t;
    if (!buf || mutedArr[trackIdx]) continue;
    const strip = strips[trackIdx];
    if (!strip) continue;
    const cfg = MEL_CFG[t];
    const trackPat = phrase.melPat[t];
    const stepPat = trackPat?.[step];
    if (!stepPat) continue;

    const activeNotes: number[] = [];
    for (let n = 0; n < 12; n++) {
      if (stepPat[n]) activeNotes.push(n);
    }

    for (const n of activeNotes) {
      const oct = octaves[t];
      if (oct === undefined) continue;
      const rate = Math.pow(2, ((oct - 1) * 12 + n) / 12);
      scheduleSample(ctx, buf, time, rate, strip.trackGain, trackIdx, stepDur);

      if (activeNotes.length === 1 && cfg && !cfg.mono) {
        const harmIdx = harmonies[t];
        if (harmIdx !== undefined && harmIdx > 0) {
          const semitones = HARMONY_SEMITONES[harmIdx];
          if (semitones !== undefined) {
            const harmRate = Math.pow(2, ((oct - 1) * 12 + n + semitones) / 12);
            scheduleSample(ctx, buf, time, harmRate, strip.trackGain, trackIdx, stepDur);
          }
        }
      }
    }
  }

  // Vocal
  const vocalIdx = DRUMS_CFG.length + MEL_CFG.length;
  const vb = vocalBuf;
  if (phrase.vocalPat[step] && !mutedArr[vocalIdx] && vb) {
    const strip = strips[vocalIdx];
    if (strip) {
      scheduleSample(ctx, vb, time, undefined, strip.trackGain, vocalIdx, stepDur);
    }
  }
}

/**
 * Render one phrase to an AudioBuffer. Returns null if the phrase is empty or
 * the live AudioContext is unavailable.
 */
export async function renderPhraseToBuffer(phraseIdx: number): Promise<AudioBuffer | null> {
  const liveCtx = getAudioContext();
  if (!liveCtx) return null;
  const phrase = phrases[phraseIdx];
  if (!phrase || isPhraseEmpty(phraseIdx)) return null;

  const sr = liveCtx.sampleRate;
  const stepDur = 60 / bpm / 4;
  const phraseDur = STEPS * stepDur;
  const totalDur = phraseDur + TAIL_SECONDS;
  const lengthSamples = Math.ceil(totalDur * sr);

  const { ctx, strips } = buildGraph(sr, lengthSamples);

  for (let s = 0; s < STEPS; s++) {
    scheduleStep(ctx, strips, phrase, s, s * stepDur, stepDur);
  }

  return ctx.startRendering();
}
