# S2400 drum export (experimental)

The download dialog exports a ZIP containing `PROJECTS/<name>/<name>.S24`, the matching `.KIT`, `MIDItracks.map`, and every drum WAV referenced by the kit. Extract the ZIP and copy that project folder into `PROJECTS` on the SD card, without replacing an existing project. Eject the card, load the `.S24` on the S2400, then select the patterns individually. The included MIDI map carries the device-default E/F track settings (F2/channel 10 is left unconfigured, as on the device); no external MIDI sequences are exported.

## Mapping and boundaries

- The five dedicated drum rows keep their pad indices A1–A5. Unused rows are omitted without shifting the remaining pads. A programmed row without a loaded sample fails explicitly.
- Each phrase containing drum steps becomes one four-bar, 4/4 pattern in phrase order. Patterns are numbered consecutively; names and `export.json` retain the source phrase number. Muted rows retain notes and mute state.
- Tempo is stored to 0.1 BPM; sixteenth-note steps use 24 ticks at 96 PPQN. The last step is tick 1512 within a 1536-tick pattern.
- Samples become 48 kHz, 16-bit PCM WAVs. Mono/stereo channels are preserved. All tracks route to output 1 (mono) or output pair 1/2 (stereo). The channel fader becomes the main slice's 0–255 level, rounded to the nearest integer.
- Synths, the sample/vocal row, effects, ADSR, pan, master volume/processing and Song-mode chains are omitted. Native one-shot retriggering cuts the previous hit on the same pad; this can differ from overlapping browser playback. This export is a playable project candidate, not a mix bounce.
- Current export limits: 30–300 BPM, 60 seconds per sample, 32 MiB of converted PCM total, mono/stereo only. Samples use a deterministic PCM16 quantizer with clipping at full scale. Names are ASCII, with fixed pad prefixes to avoid collisions.
- `README.txt` and `export.json` sit outside the project folder and describe mappings and limitations. No files are written directly to an SD card.

## API

```ts
import { exportS2400Drums } from './src/transport/s2400';
import { downloadSongAudio } from './src/transport/song-audio';

const controller = new AbortController();
const result = await exportS2400Drums({
  signal: controller.signal,
  onProgress: ({ stage, fraction }) => console.log(stage, fraction),
});
downloadSongAudio(result);
// result: blob, filename, patternCount, trackCount, warnings
```

The API snapshots patterns, tempo, mutes, faders, names and copied sample channels before its first callback or await. Resampling uses isolated offline contexts. WAV encoding and ZIP construction run in a disposable worker. Cancellation rejects with `AbortError`; it never stops live playback or mutates song state.

## Format evidence and remaining verification

The native writer was independently implemented using record facts from a user-supplied, device-saved Project002 and the [official S2400 manual](https://files.islaelectronics.com/downloads/S2400_User_Manual_July_2026.pdf). KIT fields were cross-checked against the [public Kit Builder format analysis](https://github.com/git-moss/ConvertWithMoss/blob/main/documentation/design/S2400_KIT_FORMAT.md), which describes the [official Kit Builder](https://islaelectronics.com/s2400kiteditor/). No third-party serializer implementation or private sample/project payload is bundled.

Observed files: KIT SHA-256 `c9d61522d729b827f4f85480d5d33e243a3baf74b45c5f069708fbe259cf93f9`; S24 SHA-256 `6f670283673e65eb1d950953282702444308152929d1698173a52d519e39717e`. Both parse and reconstruct byte-for-byte as little-endian typed records: type 1 unsigned integer, type 2 signed integer, type 3 length-prefixed blob. Headers use format markers `0x00020002` (KIT) and `0x00030003` (S24); these are not firmware release numbers.

The device fixture contains 129 sample triggers, 9 parameter words and one eight-bar pattern. Its first trigger/end-frame bytes (`010c000008cf1a00`) are checked directly by an independent test. New patterns repeat the observed pattern record block, with word count including parameter words. Unknown global/per-track settings retain neutral fixture values; no Song-mode records are invented. Strings are zero-initialized and sanitized; fixture string padding is not copied.

**Hardware acceptance has not been verified.** Automated checks establish structure, timing arithmetic, sample integrity, UI/API behavior and agreement with observed event bytes. They cannot prove undocumented field semantics. Multi-pattern loading, mute-mask interpretation, tempo, routing, level calibration and retrigger behavior require an S2400 test. The GUI, API and exported manifest expose this experimental status. A successful hardware test should load the project, check A1–A5 sample assignments, audition every pattern, compare BPM and last steps, and confirm mutes/levels before removing that label.
