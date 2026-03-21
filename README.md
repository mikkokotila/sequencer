# Sequencer

Browser-based step sequencer with sample playback, melodic pitch control, and a plug-and-play extension system (Vari-Mu compressor, plate reverb, tape delay, Pultec EQ, channel mixer).

## Run locally

Start a static file server from the project root:

```
python3 -m http.server 8090
```

Open [http://localhost:8090/sequencer.html](http://localhost:8090/sequencer.html).

Changes to any file (HTML, JS, CSS) take effect on browser reload — no server restart needed. The Python server serves files directly from disk on every request.

## Run tests

Open [http://localhost:8090/tests/audio-quality.html](http://localhost:8090/tests/audio-quality.html).

Tests auto-run on load. All 25 assertions must pass (see `docs/contracts/quality-gates.md`).

## Project structure

```
sequencer.html      Core sequencer (single-file app)
extensions/         Plug-and-play audio extensions
  vari-mu.js        Vari-Mu bus compressor
  mixer.js          Channel level mixer
  reverb.js         EMT 140 plate reverb
  delay.js          Echoplex EP-3 tape delay
  pultec-eq.js      Pultec EQP-1A passive EQ
tests/
  audio-quality.html  Deterministic signal path tests
docs/contracts/
  quality-gates.md    Audio quality test mandate
  use-of-color.md     Color system contract
DRUMS/              Drum sample library
SYNTHS/             Synth sample library
samples.json        Sample browser manifest
```
