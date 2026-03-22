# Audio Engine Specification

## Overview

Browser-based audio engine built on the Web Audio API with AudioWorklet DSP processors. All nonlinear stages run at 4x oversampling via 15-tap halfband FIR filters. The engine provides a canonical studio signal flow with per-channel strip routing, post-fader aux sends, a serial master insert chain, and engine-level processing.

## Channel Strip

9 tracks total: 5 drum, 3 melody (1 mono + 2 poly), 1 vocal.

Per-track routing:

```
AudioBufferSourceNode → trackGain → channelFader (0.8) → channelPan (center) → mixBus
```

| Node | Type | Default | Purpose |
|------|------|---------|---------|
| trackGain | GainNode | — | Sample playback destination |
| channelFader | GainNode | 0.8 | User-controlled channel level |
| channelPan | StereoPannerNode | 0.0 | Stereo position |

## Master Signal Flow

```
mixBus (1.0) → masterTrim (1.0) → masterGain (0.8)
  → [Pultec EQ] → [Compressor] → [Transformer]
  → engineFilter → engineSaturation → engineCompressor
  → ctx.destination
```

Aux effects (reverb, delay) return to mixBus, not masterGain — no feedback loop.

## Aux Send Architecture

Post-fader, post-pan sends from each channelPan to parallel effect buses.

```
channelPan → sendGain[i] → sendBus → [processor] → wetGain → mixBus
```

| Effect | Default Send | Bus Normalization | Return |
|--------|-------------|-------------------|--------|
| Reverb | 0.15 per track | 1/sqrt(9) = 0.333 | mixBus |
| Delay | 0.12 per track | 1/sqrt(9) = 0.333 | mixBus |

## AudioWorklet Processors

All worklets use a shared 15-tap halfband FIR kernel for 4x oversampling:

```
[-0.0063, 0, 0.0301, 0, -0.0869, 0, 0.3131, 0.5, 0.3131, 0, -0.0869, 0, 0.0301, 0, -0.0063]
```

Sum = 1.0 (unity gain per upsampling pass).

### Saturation Processor

Soft-clip waveshaper with adaptive transfer.

| Param | Default | Range | Rate |
|-------|---------|-------|------|
| drive | 0.15 | 0–1 | k-rate |
| mix | 1 | 0–1 | k-rate |

Curve: `f(x) = (pi + k) * x / (pi + k * |x|)` where `k = 1 + drive^2 * 50`.

Adaptive transfer: `levelFactor = min(1, |x| * 2.5)`. Blend scales with both drive and signal level — quiet signals pass clean.

### Compressor Processor

Three-model dynamics processor with program-dependent envelope detection.

| Param | Default | Range | Rate |
|-------|---------|-------|------|
| threshold | -18 dB | -60–0 | k-rate |
| ratio | 4 | 1–20 | k-rate |
| knee | 30 dB | 0–40 | k-rate |
| attack | 0.01 s | 0.001–0.3 | k-rate |
| release | 0.15 s | 0.01–1 | k-rate |
| makeupGain | 1 | 0–2 | k-rate |

**FET (1176-style):** Attack speeds up with GR depth via capacitor charge curve. Even-harmonic warmth at deep GR via `sin(x * pi)`. FET_K = 0.08.

**Opto (LA-2A-style):** Two-pole follower with thermal memory. Fast and slow envelope followers blended by heat accumulation. Release stretches with sustained compression.

**VCA (SSL-style):** Transient detection via slew-rate monitoring. Auto-release scales with GR depth. Precise follower with minimal coloration.

Gain reduction reported via MessagePort every ~8 blocks.

### Freeverb Processor

Schroeder-Moorer reverb: 8 parallel comb filters + 4 series allpass filters.

| Param | Default | Range | Rate |
|-------|---------|-------|------|
| roomSize | 0.7 | 0–1 | k-rate |
| damping | 0.5 | 0–1 | k-rate |
| wet | 0.3 | 0–1 | k-rate |
| dry | 1 | 0–1 | k-rate |

Comb delays (at 44.1 kHz): 1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617 samples. Allpass delays: 556, 441, 341, 225 samples. All scaled to runtime sample rate.

### Delay Processor

Hermite-interpolated tape delay with one-pole tone filter.

| Param | Default | Range | Rate |
|-------|---------|-------|------|
| delayTime | 0.375 s | 0.01–2 | k-rate |
| feedback | 0.35 | 0–0.95 | k-rate |
| tone | 0.3 | 0–1 | k-rate |
| mix | 0.25 | 0–1 | k-rate |

Feedback hard-capped at 0.95. Tone control: one-pole LPF with alpha = 0.1 + tone * 0.9.

### Transformer Processor

Analog core saturation with even-harmonic generation.

| Param | Default | Range | Rate |
|-------|---------|-------|------|
| drive | 0.15 | 0–1 | k-rate |
| color | 0.1 | 0–1 | k-rate |
| air | 0.5 | 0–1 | k-rate |

Even harmonics via `sin(x * pi)` (no DC bias). LF thickening at 80 Hz (one-pole lowshelf). HF rolloff: 10 kHz + air * 30 kHz (one-pole lowpass). Both filters gated by `drive^2 > 0.01`.

## Master Insert Extensions

Serial chain order: Pultec EQ → Compressor → Transformer.

Reverb, delay, and mixer return null from init() — they operate via aux sends or direct fader control, not the serial chain.

### Pultec EQ

Passive EQ emulation with tube coloration.

| Band | Type | Freq Range | Gain |
|------|------|-----------|------|
| Low Boost | lowshelf | 20–100 Hz | 0–10 dB |
| Low Atten | lowshelf | 20–100 Hz | 0–10 dB cut |
| High Boost | peaking | 3–16 kHz | 0–10 dB |
| High Atten | highshelf | 5–20 kHz | 0–10 dB cut |

Tube coloration via saturation processor (default off).

### Compressor Extension

Node chain: inputGain → saturation → compressor-worklet → wetGain/dryGain → outputGain.

Speed presets: FAST (2ms/50ms), MED (10ms/150ms), SLOW (50ms/400ms), HOLD (100ms/800ms).

Real GR meter via MessagePort. Real bypass: disabled state disconnects wet path entirely.

### Transformer Extension

Three controls (DRIVE, COLOR, AIR) mapped to transformer-processor params.

## Engine-Level Processing

Permanent nodes between extension chain output and destination.

| Node | Type | Control | Mapping |
|------|------|---------|---------|
| engineFilter | BiquadFilterNode (lowpass) | CUTOFF 0–1 | 200 Hz–20 kHz exponential |
| engineFilter | BiquadFilterNode (lowpass) | RESONANCE 0–1 | Q 0.707–15 |
| engineSaturation | WaveShaperNode (4x oversample) | SATURATION 0–1 | tanh curve, k = 1 + amount * 9 |
| engineCompressor | DynamicsCompressorNode | COMPRESSION 0–1 | threshold 0 to -60 dB |

## Gain Staging

| Node | Max Gain | Notes |
|------|----------|-------|
| channelFader | 1.0 | Mixer default 0.8 |
| masterGain | 0.8 | Headroom for summing |
| Compressor inputGain | 2.5 | 1 + drive^2 * 1.5 at full drive |
| Compressor outputGain | 1.5 | output * 1.5 at full output |
| Mixer master slider | 1.0 | No boost above unity |
| Aux send bus | 0.333 | 1/sqrt(trackCount) |
| Aux per-track send | 0.15 / 0.12 | Reverb / delay defaults |
| Delay feedback | 0.95 | Hard cap |

## ADSR Envelope

Per-track envelope shaping applied to every note via a dedicated GainNode per voice.

| Param | Default | Min | Max | Unit |
|-------|---------|-----|-----|------|
| Attack | 0.005 | 0.001 | 2.0 | seconds |
| Decay | 0.1 | 0.001 | 2.0 | seconds |
| Sustain | 1.0 | 0 | 1.0 | level |
| Release | 0.1 | 0.001 | 3.0 | seconds |

Audio chain per note: `source → envelopeGain → [velocityGain if MIDI] → trackGain`.

Automation uses Web Audio API scheduling: `setValueAtTime`, `linearRampToValueAtTime` (attack), `setTargetAtTime` (decay to sustain, release). Time constant = param/3 for ~95% convergence.

Scheduler notes: release auto-scheduled at step end (`stepDuration - release`). MIDI notes: release triggered on note-off via `triggerRelease()`. Default parameters produce transparent behavior (instant attack, full sustain).

## Pitch System

### Sequencer Playback

Rate formula: `rate = 2^(((octave - 1) * 12 + semitone) / 12)`.

Octave range: 1–7 (default 3). Semitone: 0–11 (C through B). At octave=1, semitone=0: rate = 1.0 (original pitch).

Harmony intervals (poly tracks only, single-note steps): unison (0), perfect 5th (+7), major 7th (+10), octave (+12) semitones.

### MIDI Live Play

Rate formula: `rate = 2^((midiNote - 24) / 12)`.

MIDI note 24 (C1) = rate 1.0. Velocity gain: velocity / 127.

Polyphony: mono tracks = 1 voice, poly tracks = 8 voices max with FIFO voice stealing.

## Sequencer

64 steps (4 bars of 16th notes), 12 phrases per song. Scheduling via Tone.js Transport with 16th-note resolution.

Pattern data: drums = boolean[track][step], melody = boolean[track][step][note] (12 notes per step), vocal = boolean[step].

## Extension State Management

All extensions receive dependencies via ExtensionHost interface (no window globals). setState guarded by enabled check — off means off. Deterministic reset via resetAllExtensions() on new song.

## Quality Assurance

Audio quality tests (OfflineAudioContext): unity gain transparency, track summing within theoretical max, waveshaper bypass purity (THD < 0.1%), aux send normalization, delay feedback stability, DC offset < 0.001, full-chain gain < 1.0.

Benchmark: real AudioWorklet process() timing, p99 < block budget (2.67 ms at 128/48 kHz).
