# Complete S2400 project archive

- User correction: the archive must include all three project sidecars shown in the supplied screenshot and every required sample. Explicit user authorization overrides the default GA-only scope. Continue in PR #45.
- Root cause: the first exporter included KIT/S24 and all referenced WAVs but omitted MIDItracks.map because internal sample playback does not depend on that file. The project-folder completeness requirement still requires it.
- Change: generate the documented device-default MIDI map and include it next to KIT/S24 and the drum samples. No MIDI sequences, synth samples or additional song features are exported. The map matches the supplied device-saved map after normalizing documented insignificant whitespace.
- Targeted verification: 11 Chrome/production tests passed. Independent ZIP/record/WAV readers require the exact project inventory; the MIDI map must match the normalized hardware-fixture digest. All five drum samples are exercised, including muted rows and late-phrase notes. The built production GUI is covered by the same completeness assertion.
- Real song: regenerated LE FEU RESTE through the GUI in an isolated Chrome context. Its project folder contains KIT, S24, MIDItracks.map and five WAVs; all 12 patterns and 983 drum hits remain. Python zipfile/wave/native-record inspection and comparison with the supplied MIDI map pass. No page errors. No SD-card files changed.
- Full repository checks and compiler-owned audio oracles run through gov:commit's embedded governance check; authoritative outcomes are in proof.manifest.json and verdict.json.
- Limitation: physical S2400 load/playback remains unverified. This correction establishes archive completeness, not device compatibility.
