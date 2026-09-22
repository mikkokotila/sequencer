/** Full-song bounce. Capture once, then render through independent copies of the live processors. */
import { DRUMS_CFG, MEL_CFG, HARMONY_SEMITONES, STEPS, TOTAL_TRACKS } from '../config';
import {
  getAudioContext,
  getChannelFaders,
  getChannelPans,
  getMasterGain,
  getMasterTrim,
} from '../engine/audio';
import {
  applyEnvelope,
  getTrackAdsr,
  isAdsrEnabled,
  getEnvelopeReleaseStart,
} from '../engine/adsr';
import { createEngineProcessing, getEngineSettings } from '../engine/master-controls';
import { loadAllWorklets } from '../engine/worklet-loader';
import { SEQ_EXTENSIONS } from '../engine/extensions/store';
import { createPultecEq } from '../engine/extensions/pultec-eq';
import { createCompressor } from '../engine/extensions/compressor';
import { createTransformer } from '../engine/extensions/transformer';
import { createReverb } from '../engine/extensions/reverb';
import { createDelay } from '../engine/extensions/delay';
import { phrases, octaves, harmonies, theory, isPhraseEmpty } from './patterns';
import { bpm, currentSongName, drumBuf, melBuf, vocalBuf, mutedArr } from './song';
import type { Extension, ExtensionHost, Phrase } from '../types';
import { normalizePhrase } from './song-format';
import { isHarmonyDisabled, melodyNotes, phraseHasNotes } from './notes';
import { snapToScale } from './theory';

export interface RenderOptions {
  /** Audition a supplied phrase sequence without mutating or saving the live song. */
  phraseOverride?: readonly Phrase[];
  harmonyOverride?: readonly number[];
  signal?: AbortSignal;
  onProgress?: (fraction: number) => void;
}
export interface RenderedSong {
  buffer: AudioBuffer;
  name: string;
  arrangementSeconds: number;
}
interface Voice {
  buffer: AudioBuffer;
  track: number;
  time: number;
  rate: number;
}

const SAMPLE_RATE = 44100;
// Native dynamics nodes settle their initial gain during silence. Live playback
// uses an already-running graph; pre-roll prevents a fade-in on the first note.
const PRE_ROLL_FRAMES = SAMPLE_RATE;
const TAIL_FLOOR = 0.00001;
const factories: Record<string, () => Extension> = {
  'pultec-eq': createPultecEq,
  compressor: createCompressor,
  transformer: createTransformer,
  reverb: createReverb,
  delay: createDelay,
};

export function checkExportAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('Export cancelled.', 'AbortError');
}

function captureSong(override?: readonly Phrase[], harmonyOverride?: readonly number[]) {
  if (
    harmonyOverride &&
    (harmonyOverride.length !== 3 ||
      harmonyOverride.some((n) => !Number.isInteger(n) || n < 0 || n > 3))
  )
    throw new Error('Invalid preview harmony settings.');
  const harmonySettings = harmonyOverride ?? harmonies;
  if (!getAudioContext()) throw new Error('The audio engine is not ready.');
  const stepDuration = 60 / bpm / 4;
  if (override && (override.length < 1 || override.length > 48))
    throw new Error('Preview requires 1–48 phrases.');
  const active = override
    ? override.map(normalizePhrase)
    : phrases.filter((_, i) => !isPhraseEmpty(i));
  if (!active.length) throw new Error('Add notes to the song before exporting.');
  const envelopes = Array.from({ length: TOTAL_TRACKS }, (_, i) => ({
    ...getTrackAdsr(i),
    enabled: isAdsrEnabled(i),
  }));
  const voices: Voice[] = [];
  let sampleEnd = active.length * STEPS * stepDuration;
  const add = (buffer: AudioBuffer | null | undefined, track: number, time: number, rate = 1) => {
    if (!buffer || mutedArr[track]) return;
    voices.push({ buffer, track, time, rate });
    const env = envelopes[track]!;
    const releaseStart = getEnvelopeReleaseStart(env, stepDuration);
    const duration = env.enabled
      ? Math.min(buffer.duration / rate, releaseStart + env.release * 4)
      : buffer.duration / rate;
    sampleEnd = Math.max(sampleEnd, time + duration);
  };
  active.forEach((phrase, p) => {
    for (let s = 0; s < STEPS; s++) {
      const time = (p * STEPS + s) * stepDuration;
      for (let t = 0; t < DRUMS_CFG.length; t++) {
        if (phrase.drumPat[t]?.[s]) add(drumBuf[t], t, time);
      }
      for (let t = 0; t < MEL_CFG.length; t++) {
        const activeNotes = melodyNotes(phrase, t, s);
        for (const n of activeNotes) {
          const pitch = ((octaves[t] ?? 3) - 1) * 12 + n;
          const track = DRUMS_CFG.length + t;
          add(melBuf[t], track, time, 2 ** (pitch / 12));
          if (
            activeNotes.length === 1 &&
            !MEL_CFG[t]?.mono &&
            !isHarmonyDisabled(phrase, t, s) &&
            (harmonySettings[t] ?? 0) > 0
          ) {
            const harmony = HARMONY_SEMITONES[harmonySettings[t]!];
            if (harmony !== undefined) {
              const target = theory.locked ? snapToScale(pitch + harmony, theory) : pitch + harmony;
              add(melBuf[t], track, time, 2 ** (target / 12));
            }
          }
        }
      }
      if (phrase.vocalPat[s]) add(vocalBuf, TOTAL_TRACKS - 1, time);
    }
  });
  if (!voices.length && (!override || active.some(phraseHasNotes)))
    throw new Error('Load samples and unmute a track with notes before exporting.');
  const extensions = SEQ_EXTENSIONS.map((ext) => ({
    id: ext.id,
    enabled: ext._enabled ?? false,
    state: structuredClone(ext.getState()),
  }));
  let effectTail = 0.1;
  for (const ext of extensions) {
    if (!ext.enabled || !(Number(ext.state.mix) > 0)) continue;
    if (ext.id === 'reverb') {
      const feedback = Math.min(0.98, 0.7 + 0.28 * Number(ext.state.decay));
      effectTail = Math.max(effectTail, (0.04 * Math.log(TAIL_FLOOR)) / Math.log(feedback) + 1);
    }
    if (ext.id === 'delay') {
      const feedback = Math.max(0, Math.min(0.95, Number(ext.state.feedback)));
      const repeats = feedback > 0 ? Math.ceil(Math.log(TAIL_FLOOR) / Math.log(feedback)) : 1;
      effectTail = Math.max(effectTail, Number(ext.state.time) * (repeats + 1) + 0.1);
    }
  }
  const length = Math.ceil((sampleEnd + effectTail) * SAMPLE_RATE);
  if (!Number.isFinite(length) || length > SAMPLE_RATE * 600) {
    throw new Error('Song exceeds the 10-minute export limit, including sample and effect tails.');
  }
  return {
    name: currentSongName,
    voices,
    stepDuration,
    envelopes,
    extensions,
    length,
    arrangementSeconds: active.length * STEPS * stepDuration,
    faders: getChannelFaders().map((node) => node.gain.value),
    pans: getChannelPans().map((node) => node.pan.value),
    master: getMasterGain()?.gain.value ?? 0.8,
    trim: getMasterTrim()?.gain.value ?? 1,
    engine: getEngineSettings(),
  };
}

/** One pass through the active phrases, matching the transport's empty-phrase skipping. */
export async function renderSongToBuffer(options: RenderOptions = {}): Promise<RenderedSong> {
  checkExportAbort(options.signal);
  // No await before capturing: UI edits and song switches cannot change an export in flight.
  const song = captureSong(options.phraseOverride, options.harmonyOverride);
  const ctx = new OfflineAudioContext(2, song.length + PRE_ROLL_FRAMES, SAMPLE_RATE);
  const nodes: AudioNode[] = [];
  const extensions: Extension[] = [];
  const sources: AudioBufferSourceNode[] = [];
  let timer: ReturnType<typeof setInterval> | undefined;
  const dispose = () => {
    if (timer !== undefined) clearInterval(timer);
    for (const source of sources) {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
    }
    for (const ext of extensions) ext.destroy();
    for (const node of nodes) node.disconnect();
  };
  const abort = () => dispose();
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    try {
      await loadAllWorklets(ctx);
    } catch {
      checkExportAbort(options.signal);
      throw new Error(
        'Could not load audio processors. Check that the app server is running and reachable, then try again.',
      );
    }
    checkExportAbort(options.signal);
    const mixBus = ctx.createGain();
    const trim = ctx.createGain();
    trim.gain.value = song.trim;
    const masterGain = ctx.createGain();
    masterGain.gain.value = song.master;
    mixBus.connect(trim);
    trim.connect(masterGain);
    nodes.push(mixBus, trim, masterGain);
    const trackGains: GainNode[] = [];
    const channelFaders: GainNode[] = [];
    const channelPans: StereoPannerNode[] = [];
    for (let t = 0; t < TOTAL_TRACKS; t++) {
      const gain = ctx.createGain();
      const fader = ctx.createGain();
      fader.gain.value = song.faders[t] ?? 0.8;
      const pan = ctx.createStereoPanner();
      pan.pan.value = song.pans[t] ?? 0;
      gain.connect(fader);
      fader.connect(pan);
      pan.connect(mixBus);
      trackGains.push(gain);
      channelFaders.push(fader);
      channelPans.push(pan);
      nodes.push(gain, fader, pan);
    }
    const host: ExtensionHost = {
      channelFaders,
      channelPans,
      mixBus,
      masterGain,
      trackCount: TOTAL_TRACKS,
      onStop: () => {
        /* Offline graph has no live transport callbacks. */
      },
      notifyStateChange: () => {
        /* Applying a snapshot must not save live state. */
      },
      getTrackInfo: () => ({ name: '', color: '', bright: '', type: 'drum' }),
    };
    let previous: AudioNode = masterGain;
    for (const state of song.extensions) {
      if (state.id === 'mixer') continue; // levels/pans were captured from the actual channel nodes
      const factory = factories[state.id];
      if (!factory) throw new Error(`Song export does not support extension: ${state.id}`);
      const ext = factory();
      extensions.push(ext);
      ext.setState(state.state);
      const pair = ext.init(ctx, host);
      ext.setEnabled?.(state.enabled);
      if (pair) {
        previous.connect(pair.input);
        previous = pair.output;
      }
    }
    const master = createEngineProcessing(ctx, song.engine);
    previous.connect(master.filter);
    master.compressor.connect(ctx.destination);
    nodes.push(master.filter, master.saturation, master.compressor);
    for (let i = 0; i < song.voices.length; i++) {
      const voice = song.voices[i]!;
      const time = voice.time + PRE_ROLL_FRAMES / SAMPLE_RATE;
      const source = ctx.createBufferSource();
      source.buffer = voice.buffer;
      source.playbackRate.value = voice.rate;
      const destination = trackGains[voice.track]!;
      const envelope = song.envelopes[voice.track]!;
      let stopAt = 0;
      if (envelope.enabled) {
        stopAt = applyEnvelope(
          ctx,
          source,
          destination,
          voice.track,
          time,
          song.stepDuration,
          envelope,
        ).stopAt;
      } else source.connect(destination);
      source.start(time);
      if (stopAt > 0) source.stop(stopAt);
      sources.push(source);
      if (i % 256 === 255) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        checkExportAbort(options.signal);
      }
    }
    checkExportAbort(options.signal);
    options.onProgress?.(0);
    timer = setInterval(
      () =>
        options.onProgress?.(
          Math.min(
            1,
            Math.max(
              0,
              (ctx.currentTime - PRE_ROLL_FRAMES / SAMPLE_RATE) / (song.length / SAMPLE_RATE),
            ),
          ),
        ),
      100,
    );
    const buffer = await ctx.startRendering();
    checkExportAbort(options.signal);
    // Preserve the complete arrangement, trimming only inaudible trailing effect padding.
    let end = buffer.length - 1;
    const minimum = PRE_ROLL_FRAMES + Math.ceil(song.arrangementSeconds * SAMPLE_RATE);
    const left = buffer.getChannelData(0),
      right = buffer.getChannelData(1);
    while (end > minimum && Math.max(Math.abs(left[end]!), Math.abs(right[end]!)) < TAIL_FLOOR)
      end--;
    const frames = Math.min(buffer.length, end + 1 + Math.ceil(0.05 * SAMPLE_RATE));
    const trimmed = new AudioBuffer({
      numberOfChannels: 2,
      length: frames - PRE_ROLL_FRAMES,
      sampleRate: SAMPLE_RATE,
    });
    trimmed.copyToChannel(left.subarray(PRE_ROLL_FRAMES, frames), 0);
    trimmed.copyToChannel(right.subarray(PRE_ROLL_FRAMES, frames), 1);
    options.onProgress?.(1);
    return { buffer: trimmed, name: song.name, arrangementSeconds: song.arrangementSeconds };
  } finally {
    options.signal?.removeEventListener('abort', abort);
    dispose();
  }
}
